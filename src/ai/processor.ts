/**
 * processor.ts — the background worker that makes the library "smart".
 *
 * For every photo that hasn't been processed yet it:
 *   1. Loads the original from disk (via yaadein://original/<id>)
 *        HEIC (iPhone) photos are converted to JPEG first with `heic2any`
 *   2. Saves a small THUMBNAIL (480px) for the fast grid
 *        + a large PREVIEW for HEIC (Chrome can't display HEIC directly)
 *   3. Finds FACES → saves a little face crop + 128-number descriptor
 *   4. Recognises OBJECTS/SCENES → labels ("pizza", "seashore") + categories
 *   5. Every so often groups faces into PEOPLE (clusterFaces.ts)
 *
 * It processes one photo at a time and yields to the UI between photos,
 * so scrolling stays smooth. You can pause it from the progress pill.
 * Everything is saved, so closing the app just resumes next time.
 */
import { api } from '../api/client';
import type { Face, Label, Photo } from '../api/types';
import { useLibrary } from '../state/useLibrary';
import { loadModels, faceapi, type Models } from './models';
import { categorize, primaryName } from './categories';
import { clusterFaces } from './clusterFaces';

const THUMB_SIZE = 480;
const PREVIEW_SIZE = 2048;
const AI_SIZE = 1024; // faces are detected on a 1024px version: fast & accurate enough
const FACE_CROP = 160;

let running = false;

/** Start (or nudge) the background processor. Safe to call many times. */
export function kickProcessor() {
  if (running || !api.desktop) return;
  running = true;
  run()
    .catch((err) => useLibrary.getState().setAi({ error: String(err?.message || err) }))
    .finally(() => {
      running = false;
      useLibrary.getState().setAi({ running: false, current: undefined });
    });
}

/** Which photos still need work? */
function pending(photos: Photo[], aiEnabled: boolean) {
  return photos.filter((p) => !p.hasThumb || (aiEnabled && p.type === 'image' && !p.aiDone));
}

async function run() {
  const store = useLibrary.getState;
  const aiEnabled = store().settings?.aiEnabled ?? true;
  let queue = pending(store().photos, aiEnabled);
  if (!queue.length) return;

  store().setAi({ running: true, done: 0, total: queue.length, error: undefined });
  // If the AI models fail to load we still make thumbnails, and show the error.
  const models = aiEnabled
    ? await loadModels().catch((err) => {
        console.error('[ai] models failed to load', err);
        store().setAi({ error: `AI models failed to load: ${err?.message || err}` });
        return null;
      })
    : null;
  store().setAi({ labelsAvailable: Boolean(models?.labels) });

  // Changes are buffered and pushed into the UI state in batches,
  // otherwise the grid would re-render after every single photo.
  let photoPatches: Record<string, Partial<Photo>> = {};
  let newFaces: Face[] = [];
  let lastFlush = Date.now();
  let lastGrouping = 0; // grouping lonely faces into new people is heavier → every 20s
  let done = 0;

  const flush = async (groupLoners: boolean) => {
    if (Object.keys(photoPatches).length) store().patchPhotos(photoPatches);
    if (newFaces.length) store().addFaces(newFaces);
    photoPatches = {};
    newFaces = [];
    lastFlush = Date.now();
    await regroupPeople(groupLoners);
  };

  while (queue.length) {
    for (const photo of queue) {
      // Pause support: wait while the user has paused processing.
      while (store().ai.paused) await sleep(500);

      store().setAi({ current: photo.name });
      try {
        const result = await processOne(photo, models);
        photoPatches[photo.id] = result.patch;
        newFaces.push(...result.faces);
      } catch (err) {
        // Broken/unsupported file: mark done so we don't retry forever.
        console.warn('[processor] skipped', photo.path, err);
        photoPatches[photo.id] = { hasThumb: true, aiDone: true };
        await api.desktop!.saveAi({ photoId: photo.id, labels: [], categories: [], faces: [] }).catch(() => {});
      }
      done++;
      store().setAi({ done });

      if (Date.now() - lastFlush > 2500) {
        const groupNow = Date.now() - lastGrouping > 20_000;
        if (groupNow) lastGrouping = Date.now();
        await flush(groupNow);
      }
      await sleep(0); // let React paint
    }
    await flush(true);
    // New photos may have arrived (a scan running at the same time).
    queue = pending(store().photos, aiEnabled);
    if (queue.length) store().setAi({ total: done + queue.length });
  }
}

/** Process a single photo. Returns the changes to apply. */
async function processOne(photo: Photo, models: Models | null): Promise<{ patch: Partial<Photo>; faces: Face[] }> {
  const desktop = api.desktop!;
  const patch: Partial<Photo> = {};
  let source: ImageBitmap | HTMLCanvasElement;

  if (photo.type === 'video') {
    source = await grabVideoFrame(api.mediaUrl('original', photo.id));
  } else {
    let blob = await (await fetch(api.mediaUrl('original', photo.id))).blob();
    if (photo.ext === '.heic' || photo.ext === '.heif') {
      // Lazy-load the HEIC converter only when needed (it's ~1MB).
      const heic2any = (await import('heic2any')).default;
      blob = (await heic2any({ blob, toType: 'image/jpeg', quality: 0.9 })) as Blob;
      const preview = await resizeToJpeg(await createImageBitmap(blob), PREVIEW_SIZE, 0.88);
      await desktop.saveMedia('preview', photo.id, preview.bytes);
      patch.hasPreview = true;
    }
    // imageOrientation 'from-image' = respect the EXIF rotation from the camera.
    source = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  }

  const width = source.width;
  const height = source.height;

  // 1) thumbnail
  if (!photo.hasThumb) {
    const thumb = await resizeToJpeg(source, THUMB_SIZE, 0.8);
    await desktop.saveMedia('thumb', photo.id, thumb.bytes, { width, height });
    Object.assign(patch, { hasThumb: true, width, height });
  }

  // 2) AI (images only)
  if (!models || photo.type !== 'image' || photo.aiDone) {
    if ('close' in source) source.close();
    return { patch, faces: [] };
  }
  const canvas = drawScaled(source, AI_SIZE);
  if ('close' in source) source.close();

  // --- faces
  const detections = await faceapi
    .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.55, maxResults: 30 }))
    .withFaceLandmarks()
    .withFaceDescriptors();

  const faces: Face[] = [];
  let faceArea = 0;
  for (const d of detections) {
    const b = d.detection.box;
    if (b.width < 36 || b.height < 36) continue; // too tiny/blurry to recognise reliably
    const face: Face = {
      id: `f_${crypto.randomUUID()}`,
      photoId: photo.id,
      personId: null,
      score: +d.detection.score.toFixed(3),
      box: {
        x: +(b.x / canvas.width).toFixed(4),
        y: +(b.y / canvas.height).toFixed(4),
        w: +(b.width / canvas.width).toFixed(4),
        h: +(b.height / canvas.height).toFixed(4),
      },
      // 4 decimals is plenty and keeps library.json small
      descriptor: Array.from(d.descriptor, (n) => +n.toFixed(4)),
    };
    faceArea += face.box.w * face.box.h;
    faces.push(face);
    const crop = await cropFace(canvas, b);
    await desktop.saveMedia('face', face.id, crop);
  }

  // --- objects & scenes
  let raw: Array<{ className: string; probability: number }> = [];
  if (models.labels) raw = await models.labels.classify(canvas, 5);
  const labels: Label[] = raw.filter((l) => l.probability >= 0.12).map((l) => ({ name: primaryName(l.className), score: +l.probability.toFixed(3) }));
  const categories = categorize(raw, { faceArea, faceCount: faces.length, name: photo.name, ext: photo.ext, camera: photo.camera });

  await desktop.saveAi({ photoId: photo.id, labels, categories, faces });
  Object.assign(patch, { aiDone: true, labels, categories, faceIds: faces.map((f) => f.id) });
  return { patch, faces };
}

/** Assign new faces to people and create new people. */
async function regroupPeople(groupLoners: boolean) {
  const s = useLibrary.getState();
  const threshold = s.settings?.faceMatchThreshold ?? 0.5;
  const { newPeople, assignments } = clusterFaces(s.faces, s.people, threshold, groupLoners);
  if (!newPeople.length && !Object.keys(assignments).length) return;
  await api.desktop!.applyPeople(newPeople, assignments);
  const faces = s.faces.map((f) => (assignments[f.id] ? { ...f, personId: assignments[f.id] } : f));
  s.setPeopleState([...s.people, ...newPeople], faces);
}

// ---------------------------------------------------------------------------
//  Canvas helpers
// ---------------------------------------------------------------------------

/** Draw an image into a canvas no bigger than `max` px on its longest side. */
function drawScaled(src: CanvasImageSource & { width: number; height: number }, max: number) {
  const scale = Math.min(1, max / Math.max(src.width, src.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(src.width * scale));
  canvas.height = Math.max(1, Math.round(src.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function resizeToJpeg(src: CanvasImageSource & { width: number; height: number }, max: number, quality: number) {
  const canvas = drawScaled(src, max);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', quality));
  return { bytes: await blob.arrayBuffer(), width: canvas.width, height: canvas.height };
}

/** Square face crop with some margin, as a small JPEG. */
async function cropFace(canvas: HTMLCanvasElement, b: { x: number; y: number; width: number; height: number }) {
  const size = Math.max(b.width, b.height) * 1.6; // 60% margin looks natural
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const out = document.createElement('canvas');
  out.width = out.height = FACE_CROP;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#2a221c';
  ctx.fillRect(0, 0, FACE_CROP, FACE_CROP);
  ctx.drawImage(canvas, cx - size / 2, cy - size / 2, size, size, 0, 0, FACE_CROP, FACE_CROP);
  const blob = await new Promise<Blob>((res) => out.toBlob((x) => res(x!), 'image/jpeg', 0.85));
  return blob.arrayBuffer();
}

/** Grab a frame ~1s into a video for its thumbnail. */
function grabVideoFrame(url: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    const timer = setTimeout(() => reject(new Error('video timeout')), 15000);
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, (video.duration || 2) / 2);
    };
    video.onseeked = () => {
      clearTimeout(timer);
      const c = drawScaled(Object.assign(video, { width: video.videoWidth, height: video.videoHeight }), PREVIEW_SIZE);
      video.removeAttribute('src');
      video.load();
      resolve(c);
    };
    video.onerror = () => {
      clearTimeout(timer);
      reject(new Error('video cannot be decoded'));
    };
    video.src = url;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
