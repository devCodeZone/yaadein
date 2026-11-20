/**
 * ============================================================================
 *  scanner.cjs — finds photos & videos inside a folder (or a whole hard disk)
 * ============================================================================
 *
 *  What it does, step by step:
 *   1. Walk every sub-folder and collect photo/video files.
 *   2. For each file, read cheap metadata WITHOUT decoding the image:
 *        - file size + modified time            (fs.stat)
 *        - date taken, camera, GPS location     (EXIF via the `exifr` library)
 *        - Google Takeout ".json" side-car date (if you exported from Google)
 *        - a "fingerprint" (hash of size + first/last 64KB) for duplicates
 *   3. Save/refresh a Photo record in the store.
 *   4. Remove records whose file was deleted from disk.
 *
 *  The heavy stuff — thumbnails, faces, objects — happens later in the UI
 *  (see src/ai/processor.ts) because the browser engine can decode images and
 *  run TensorFlow on your GPU without freezing the app.
 *
 *  Re-scanning is INCREMENTAL: if size + modified time didn't change we skip
 *  the file entirely, so rescanning a 50,000-photo disk takes seconds.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const exifr = require('exifr');
const { LibraryStore } = require('./store.cjs');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif', '.avif', '.tif', '.tiff']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.3gp']);

/** Folders we never look inside (system junk, app caches, our own duplicates bin). */
const SKIP_DIRS = new Set([
  '$recycle.bin',
  'system volume information',
  'node_modules',
  '@eadir', // Synology NAS thumbnails
  '.thumbnails',
  '_duplicates', // where Yaadein parks duplicate copies (see organizer.cjs)
]);

/** Images smaller than this are almost always icons / cached web images. */
const MIN_IMAGE_BYTES = 8 * 1024;

function mediaType(file) {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

/**
 * Async generator that yields every media file path under `root`.
 * Using a generator means we never hold huge arrays of directory entries.
 */
async function* walk(root) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // permission denied etc. — just skip that folder
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const lower = entry.name.toLowerCase();
        if (lower.startsWith('.') || SKIP_DIRS.has(lower)) continue;
        stack.push(full);
      } else if (entry.isFile() && mediaType(entry.name)) {
        yield full;
      }
    }
  }
}

/**
 * Fast fingerprint: SHA-1 of (file size + first 64KB + last 64KB).
 * Reading whole files would take hours on a big disk; this takes milliseconds
 * and is almost never wrong. Duplicates are double-checked with a full hash
 * in organizer.cjs before anything is moved.
 */
async function quickFingerprint(file, size) {
  const CHUNK = 64 * 1024;
  const handle = await fsp.open(file, 'r');
  try {
    const hash = crypto.createHash('sha1');
    hash.update(String(size));
    const head = Buffer.alloc(Math.min(CHUNK, size));
    await handle.read(head, 0, head.length, 0);
    hash.update(head);
    if (size > CHUNK) {
      const tail = Buffer.alloc(Math.min(CHUNK, size - CHUNK));
      await handle.read(tail, 0, tail.length, size - tail.length);
      hash.update(tail);
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

/** Read EXIF metadata. Returns {} when the file has none. */
async function readExif(file) {
  try {
    const exif = await exifr.parse(file, {
      tiff: true,
      exif: true,
      gps: true,
      ifd1: false,
      xmp: false,
      icc: false,
      iptc: false,
      translateValues: true,
      reviveValues: true, // turns date strings into JS Date objects
    });
    return exif || {};
  } catch {
    return {};
  }
}

/**
 * Google Takeout puts the real "photo taken" date in a side-car JSON file next
 * to each photo, e.g.  IMG_1234.jpg  +  IMG_1234.jpg.supplemental-metadata.json
 * (older exports: IMG_1234.jpg.json). We cache directory listings so we only
 * read each folder's file list once.
 */
const jsonListCache = new Map();
async function readTakeoutSidecar(file) {
  const dir = path.dirname(file);
  if (!jsonListCache.has(dir)) {
    try {
      const names = (await fsp.readdir(dir)).filter((n) => n.toLowerCase().endsWith('.json'));
      jsonListCache.set(dir, names);
    } catch {
      jsonListCache.set(dir, []);
    }
  }
  const base = path.basename(file);
  const match = jsonListCache.get(dir).find((n) => n.startsWith(base + '.'));
  if (!match) return null;
  try {
    const json = JSON.parse(await fsp.readFile(path.join(dir, match), 'utf8'));
    const ts = Number(json.photoTakenTime?.timestamp) * 1000;
    const geo = json.geoData && (json.geoData.latitude || json.geoData.longitude) ? json.geoData : null;
    return {
      takenAt: Number.isFinite(ts) && ts > 0 ? ts : null,
      gps: geo ? { lat: geo.latitude, lng: geo.longitude } : null,
    };
  } catch {
    return null;
  }
}

/**
 * Many phones name files with the date: IMG_20210314_101500.jpg,
 * WhatsApp: IMG-20210314-WA0001.jpg, Screenshot_2021-03-14-...png
 */
function dateFromFilename(name) {
  const m = name.match(/(19[89]\d|20[0-4]\d)[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])/);
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Build a brand-new Photo record (or refresh one whose file changed). */
async function buildPhotoRecord(file, stat, sourceId, previous) {
  const type = mediaType(file);
  const exif = type === 'image' ? await readExif(file) : {};
  const sidecar = await readTakeoutSidecar(file);

  // Pick the most trustworthy date we can find.
  let takenAt = null;
  let dateSource = 'file';
  const exifDate = exif.DateTimeOriginal || exif.CreateDate;
  if (exifDate instanceof Date && !isNaN(exifDate)) {
    takenAt = exifDate.getTime();
    dateSource = 'exif';
  } else if (sidecar?.takenAt) {
    takenAt = sidecar.takenAt;
    dateSource = 'takeout';
  } else if (dateFromFilename(path.basename(file))) {
    takenAt = dateFromFilename(path.basename(file));
    dateSource = 'filename';
  } else {
    takenAt = stat.mtimeMs;
  }

  const gps =
    typeof exif.latitude === 'number' && typeof exif.longitude === 'number'
      ? { lat: +exif.latitude.toFixed(5), lng: +exif.longitude.toFixed(5) }
      : sidecar?.gps || null;

  const camera = [exif.Make, exif.Model].filter(Boolean).join(' ').trim() || null;

  return {
    id: previous?.id || LibraryStore.newId('p'),
    path: file,
    name: path.basename(file),
    folder: path.dirname(file),
    ext: path.extname(file).toLowerCase(),
    type,
    sourceId,
    size: stat.size,
    mtime: Math.round(stat.mtimeMs),
    takenAt: Math.round(takenAt),
    dateSource,
    width: exif.ExifImageWidth || exif.ImageWidth || null,
    height: exif.ExifImageHeight || exif.ImageHeight || null,
    camera,
    gps,
    fingerprint: await quickFingerprint(file, stat.size),
    // Filled in later by the UI's background processor:
    hasThumb: false,
    hasPreview: false,
    aiDone: false,
    labels: [],
    categories: [],
    faceIds: [],
    // Things YOU set — keep them if the file is simply being refreshed:
    favorite: previous?.favorite || false,
  };
}

/**
 * Scan one Source (a folder on your disk).
 *
 * @param {LibraryStore} store
 * @param {{id:string, path:string}} source
 * @param {{ onProgress?: Function, signal?: {aborted:boolean} }} opts
 * @returns {Promise<{added:number, updated:number, removed:number, total:number}>}
 */
async function scanSource(store, source, { onProgress = () => {}, signal } = {}) {
  const { photos, faces } = store.data;
  jsonListCache.clear();

  // 1) Collect files first so we can show "123 / 4,567" progress.
  onProgress({ phase: 'listing', done: 0, total: 0, message: `Looking for photos in ${source.path}` });
  const files = [];
  for await (const file of walk(source.path)) {
    if (signal?.aborted) break;
    files.push(file);
    if (files.length % 500 === 0) {
      onProgress({ phase: 'listing', done: files.length, total: 0, message: `Found ${files.length} files…` });
    }
  }

  // path -> photo lookup so we know what we already have.
  const byPath = new Map(Object.values(photos).map((p) => [p.path, p]));
  const stats = { added: 0, updated: 0, removed: 0, total: files.length };

  // 2) Process files with a small concurrency pool (disk-friendly).
  let index = 0;
  let done = 0;
  async function worker() {
    while (index < files.length && !signal?.aborted) {
      const file = files[index++];
      try {
        const stat = await fsp.stat(file);
        const type = mediaType(file);
        if (type === 'image' && stat.size < MIN_IMAGE_BYTES) continue;

        const existing = byPath.get(file);
        const unchanged = existing && existing.size === stat.size && existing.mtime === Math.round(stat.mtimeMs);
        if (!unchanged) {
          // File is new or was edited: (re)build its record.
          if (existing) {
            for (const faceId of existing.faceIds) delete faces[faceId];
          }
          const record = await buildPhotoRecord(file, stat, existing?.sourceId || source.id, existing);
          photos[record.id] = record;
          byPath.set(file, record);
          existing ? stats.updated++ : stats.added++;
        }
      } catch (err) {
        console.warn('[scanner] skipped', file, err.message);
      } finally {
        done++;
        if (done % 25 === 0 || done === files.length) {
          onProgress({ phase: 'reading', done, total: files.length, message: `Reading ${path.basename(file)}` });
        }
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));

  // 3) Forget photos of this source whose file no longer exists on disk.
  //    (Photos you MOVED with the organizer keep their record because the
  //    organizer updates their path.)
  if (!signal?.aborted) {
    for (const photo of Object.values(photos)) {
      if (photo.sourceId === source.id && !fs.existsSync(photo.path)) {
        for (const faceId of photo.faceIds) delete faces[faceId];
        delete photos[photo.id];
        stats.removed++;
      }
    }
  }

  source.lastScanAt = Date.now();
  store.save();
  return stats;
}

module.exports = {
  scanSource,
  walk,
  mediaType,
  quickFingerprint,
  dateFromFilename,
  readTakeoutSidecar,
  IMAGE_EXT,
  VIDEO_EXT,
};
