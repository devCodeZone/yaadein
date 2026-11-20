/**
 * ============================================================================
 *  organizer.cjs — arranges your photos into neat folders ON YOUR HARD DISK
 * ============================================================================
 *
 *  Three steps, exactly like a "preview → confirm → undo" UX:
 *
 *   1. planOrganize()  – works out WHERE every photo would go. Touches nothing.
 *   2. applyPlan()     – copies or moves the files, writes an undo log.
 *   3. undoBatch()     – puts everything back the way it was.
 *
 *  Folder styles:
 *    date    →  Target/2024/03 - March/IMG_001.jpg
 *    year    →  Target/2024/IMG_001.jpg
 *    people  →  Target/People/Riya/IMG_001.jpg       (copy only*)
 *    things  →  Target/Things/Dogs/IMG_001.jpg
 *    source  →  Target/<original folder name>/IMG_001.jpg
 *
 *   *A group photo of Riya and Aman belongs in BOTH folders, and one file can't
 *    be moved to two places — so "people" always COPIES.
 *
 *  Duplicates:
 *    findDuplicates()   – groups identical files (quick fingerprint, then a
 *                         full SHA-1 to be 100% sure).
 *    planDuplicateMoves – moves extra copies into  <their folder>/_Duplicates/
 *                         Nothing is ever deleted; you empty that folder
 *                         yourself once you're happy.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { LibraryStore } = require('./store.cjs');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Remove characters Windows/macOS don't allow in folder names. */
function safeName(name) {
  return (
    String(name || 'Unknown')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Unknown'
  );
}

/**
 * Which sub-folder(s) should this photo go into?
 * Returns an array because a photo can belong to many people/things.
 */
function foldersFor(photo, style, ctx) {
  const d = new Date(photo.takenAt);
  const year = String(d.getFullYear());
  switch (style) {
    case 'date':
      return [path.join(year, `${String(d.getMonth() + 1).padStart(2, '0')} - ${MONTHS[d.getMonth()]}`)];
    case 'year':
      return [year];
    case 'source':
      return [safeName(path.basename(photo.folder))];
    case 'people': {
      const names = new Set();
      for (const faceId of photo.faceIds) {
        const face = ctx.faces[faceId];
        const person = face?.personId && ctx.people[face.personId];
        if (!person || person.hidden) continue;
        // Only people you've NAMED get a folder. Unnamed groups go to
        // People/_Unnamed/<short id> only if you ticked "include unsorted".
        if (person.name) names.add(safeName(person.name));
        else if (ctx.includeUnsorted) names.add(path.join('_Unnamed', person.id.slice(2, 8)));
      }
      if (!names.size) return ctx.includeUnsorted ? [path.join('People', '_No people')] : [];
      return [...names].map((n) => path.join('People', n));
    }
    case 'things': {
      const cats = photo.categories?.length ? photo.categories : [];
      if (!cats.length) return ctx.includeUnsorted ? [path.join('Things', '_Other')] : [];
      // Only the main (first) category so a photo isn't copied 4 times.
      return [path.join('Things', safeName(cats[0]))];
    }
    default:
      throw new Error(`Unknown organize style: ${style}`);
  }
}

/**
 * Work out the plan. Pure calculation — no files are touched.
 *
 * @param {LibraryStore} store
 * @param {{style:string, action:'copy'|'move', target:string, photoIds?:string[], includeUnsorted?:boolean}} opts
 * @returns {{ops:Array<{photoId,from,to}>, skipped:number, action:string, style:string, target:string}}
 */
function planOrganize(store, { style, action, target, photoIds, includeUnsorted = false }) {
  if (!target) throw new Error('Please choose a target folder first.');
  if (style === 'people' && action === 'move') action = 'copy'; // see header comment

  const { photos, faces, people } = store.data;
  const list = photoIds?.length ? photoIds.map((id) => photos[id]).filter(Boolean) : Object.values(photos);

  const ops = [];
  const taken = new Set(); // destination paths already used in THIS plan
  let skipped = 0;

  for (const photo of list) {
    const folders = foldersFor(photo, style, { faces, people, includeUnsorted });
    if (!folders.length) {
      skipped++;
      continue;
    }
    for (const sub of folders) {
      const dir = path.join(target, sub);
      let dest = path.join(dir, photo.name);

      // Already exactly where it should be? Nothing to do.
      if (path.resolve(dest) === path.resolve(photo.path)) {
        skipped++;
        continue;
      }
      // Name clash (two different "IMG_0001.jpg"s): add " (1)", " (2)" ...
      let n = 1;
      while (taken.has(dest.toLowerCase()) || existsDifferentFile(dest, photo)) {
        if (existsSameFile(dest, photo)) break; // identical file already there
        const { name, ext } = path.parse(photo.name);
        dest = path.join(dir, `${name} (${n++})${ext}`);
      }
      if (existsSameFile(dest, photo)) {
        skipped++; // an identical copy is already in the target
        continue;
      }
      taken.add(dest.toLowerCase());
      ops.push({ photoId: photo.id, from: photo.path, to: dest });
    }
  }
  return { ops, skipped, action, style, target };
}

function existsSameFile(dest, photo) {
  try {
    return fs.statSync(dest).size === photo.size;
  } catch {
    return false;
  }
}
function existsDifferentFile(dest, photo) {
  try {
    return fs.statSync(dest).size !== photo.size;
  } catch {
    return false;
  }
}

/** Move a file, even across drives (rename fails across drives with EXDEV). */
async function moveFile(from, to) {
  try {
    await fsp.rename(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    // Keep the original "modified" date on the copy, then remove the original.
    const st = await fsp.stat(from);
    await fsp.utimes(to, st.atime, st.mtime);
    await fsp.unlink(from);
  }
}

async function copyFile(from, to) {
  await fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL);
  const st = await fsp.stat(from);
  await fsp.utimes(to, st.atime, st.mtime); // keep original dates
}

/**
 * Execute a plan. Every successful operation is logged so it can be undone.
 * For MOVE we also update the photo's path in the library so the app keeps
 * working (faces, favorites, etc. stay attached).
 */
async function applyPlan(store, plan, { onProgress = () => {}, label } = {}) {
  const batch = {
    id: LibraryStore.newId('b'),
    at: Date.now(),
    action: plan.action,
    style: plan.style,
    target: plan.target,
    label: label || `${plan.action === 'move' ? 'Moved' : 'Copied'} by ${plan.style}`,
    ops: [],
    errors: [],
  };

  let done = 0;
  for (const op of plan.ops) {
    try {
      await fsp.mkdir(path.dirname(op.to), { recursive: true });
      if (plan.action === 'move') {
        await moveFile(op.from, op.to);
        const photo = store.data.photos[op.photoId];
        if (photo) {
          photo.path = op.to;
          photo.folder = path.dirname(op.to);
          photo.name = path.basename(op.to);
        }
      } else {
        await copyFile(op.from, op.to);
      }
      batch.ops.push(op);
    } catch (err) {
      batch.errors.push({ ...op, error: err.message });
    }
    done++;
    if (done % 10 === 0 || done === plan.ops.length) {
      onProgress({ done, total: plan.ops.length, message: path.basename(op.to) });
    }
  }

  store.data.organizeLog.unshift(batch);
  store.data.organizeLog = store.data.organizeLog.slice(0, 50); // keep last 50
  store.save();
  return { batchId: batch.id, done: batch.ops.length, errors: batch.errors };
}

/**
 * Undo a batch:
 *   - copies are deleted (only if the copy is still the same size, i.e. untouched)
 *   - moves are moved back to the original location
 */
async function undoBatch(store, batchId, { onProgress = () => {} } = {}) {
  const batch = store.data.organizeLog.find((b) => b.id === batchId);
  if (!batch) throw new Error('That history entry no longer exists.');
  if (batch.undone) throw new Error('This was already undone.');

  let done = 0;
  const errors = [];
  for (const op of [...batch.ops].reverse()) {
    try {
      if (batch.action === 'move') {
        await fsp.mkdir(path.dirname(op.from), { recursive: true });
        await moveFile(op.to, op.from);
        const photo = store.data.photos[op.photoId];
        if (photo) {
          photo.path = op.from;
          photo.folder = path.dirname(op.from);
          photo.name = path.basename(op.from);
        }
      } else {
        const original = store.data.photos[op.photoId];
        const st = await fsp.stat(op.to);
        if (!original || st.size === original.size) await fsp.unlink(op.to);
      }
      await removeEmptyDirs(path.dirname(op.to), batch.target);
    } catch (err) {
      errors.push({ ...op, error: err.message });
    }
    done++;
    if (done % 10 === 0) onProgress({ done, total: batch.ops.length, message: 'Undoing…' });
  }
  batch.undone = true;
  store.save();
  return { done, errors };
}

/** After undo, tidy up folders we created that are now empty. */
async function removeEmptyDirs(dir, stopAt) {
  if (!stopAt) return;
  const stop = path.resolve(stopAt);
  let current = path.resolve(dir);
  while (current.startsWith(stop) && current !== stop) {
    try {
      const entries = await fsp.readdir(current);
      if (entries.length) return;
      await fsp.rmdir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

/** Full-content SHA-1 (streamed, so large videos don't fill memory). */
function fullHash(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(file)
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/**
 * Find duplicate groups.
 * Returns [{ hash, size, photoIds: [keeperId, ...extras] }]
 * The "keeper" is the copy with the oldest date / shortest path — usually the
 * original — but the UI lets you pick another one.
 */
async function findDuplicates(store, { onProgress = () => {} } = {}) {
  const byPrint = new Map();
  for (const p of Object.values(store.data.photos)) {
    if (!byPrint.has(p.fingerprint)) byPrint.set(p.fingerprint, []);
    byPrint.get(p.fingerprint).push(p);
  }
  const candidates = [...byPrint.values()].filter((g) => g.length > 1);

  const groups = [];
  let done = 0;
  for (const group of candidates) {
    // Confirm with a full hash — the quick fingerprint could (very rarely) collide.
    const byFull = new Map();
    for (const p of group) {
      try {
        const h = await fullHash(p.path);
        if (!byFull.has(h)) byFull.set(h, []);
        byFull.get(h).push(p);
      } catch {
        /* file vanished — ignore */
      }
    }
    for (const [hash, same] of byFull) {
      if (same.length < 2) continue;
      same.sort((a, b) => a.mtime - b.mtime || a.path.length - b.path.length);
      groups.push({ hash, size: same[0].size, photoIds: same.map((p) => p.id) });
    }
    done++;
    onProgress({ done, total: candidates.length, message: 'Comparing files…' });
  }
  groups.sort((a, b) => b.size * b.photoIds.length - a.size * a.photoIds.length);
  return groups;
}

/**
 * Plan: move every non-keeper into a "_Duplicates" folder next to it.
 * @param {Array<{keepId:string, photoIds:string[]}>} selections
 */
function planDuplicateMoves(store, selections) {
  const ops = [];
  for (const { keepId, photoIds } of selections) {
    for (const id of photoIds) {
      if (id === keepId) continue;
      const p = store.data.photos[id];
      if (!p) continue;
      let to = path.join(p.folder, '_Duplicates', p.name);
      let n = 1;
      while (fs.existsSync(to)) {
        const { name, ext } = path.parse(p.name);
        to = path.join(p.folder, '_Duplicates', `${name} (${n++})${ext}`);
      }
      ops.push({ photoId: id, from: p.path, to });
    }
  }
  return { ops, skipped: 0, action: 'move', style: 'duplicates', target: '' };
}

module.exports = {
  planOrganize,
  applyPlan,
  undoBatch,
  findDuplicates,
  planDuplicateMoves,
  safeName,
  foldersFor,
};
