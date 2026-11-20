/**
 * models.ts — loads the on-device AI models (TensorFlow.js).
 *
 * Nothing is uploaded anywhere: the neural networks run inside the app, on
 * your graphics card (WebGL) when possible, otherwise on the CPU.
 *
 *  ┌───────────────────────┬──────────────────────────────────────────────┐
 *  │ Model                 │ What it gives us                              │
 *  ├───────────────────────┼──────────────────────────────────────────────┤
 *  │ SSD MobileNet v1      │ WHERE the faces are (boxes)                   │
 *  │ Face landmark 68      │ eyes/nose/mouth points → aligns the face      │
 *  │ Face recognition net  │ 128 numbers per face ("descriptor"). Two      │
 *  │                       │ photos of the same person → numbers are close │
 *  │ MobileNet v2 (ImageNet│ WHAT is in the photo: 1,000 objects & scenes │
 *  └───────────────────────┴──────────────────────────────────────────────┘
 *
 * Face models ship inside the app (public/models/face, copied from the
 * @vladmandic/face-api package by scripts/copy-models.cjs).
 * The object model is loaded from public/models/mobilenet if you ran
 * `npm run download-models`, otherwise from Google's TF Hub (needs internet
 * the first time; the browser cache keeps it afterwards).
 */
import * as tf from '@tensorflow/tfjs';
// "nobundle" build = face-api WITHOUT its own copy of TensorFlow, so face-api
// and MobileNet share one TensorFlow instance (half the memory, one GPU context).
import * as faceapi from '@vladmandic/face-api/dist/face-api.esm-nobundle.js';
import * as mobilenet from '@tensorflow-models/mobilenet';

export { faceapi };

let loading: Promise<Models> | null = null;

export interface Models {
  labels: mobilenet.MobileNet | null; // null if it couldn't be downloaded
  backend: string;
}

/** Load all models once; later calls reuse the same promise. */
export function loadModels(): Promise<Models> {
  if (!loading) loading = doLoad();
  return loading;
}

async function doLoad(): Promise<Models> {
  // Prefer the GPU. Fall back to CPU if WebGL isn't available.
  // setBackend() resolves to false (instead of throwing) when WebGL is blocked.
  const gpu = await tf.setBackend('webgl').catch(() => false);
  if (!gpu) await tf.setBackend('cpu');
  await tf.ready();

  // Relative path on purpose: face-api mangles custom-protocol URLs like
  // yaadein://app/…, but a relative path works on desktop, phone and dev server.
  const faceDir = 'models/face';
  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri(faceDir),
    faceapi.nets.faceLandmark68Net.loadFromUri(faceDir),
    faceapi.nets.faceRecognitionNet.loadFromUri(faceDir),
  ]);

  // Object model: local copy first, then TF Hub.
  let labels: mobilenet.MobileNet | null = null;
  const localUrl = new URL('./models/mobilenet/model.json', window.location.href).toString();
  try {
    const head = await fetch(localUrl, { method: 'GET' });
    if (head.ok && (head.headers.get('content-type') || '').includes('json')) {
      labels = await mobilenet.load({ version: 2, alpha: 1.0, modelUrl: localUrl, inputRange: [0, 1] });
    }
  } catch {
    /* no local copy */
  }
  if (!labels) {
    try {
      labels = await mobilenet.load({ version: 2, alpha: 1.0 });
    } catch (err) {
      console.warn('[ai] object model unavailable (offline?) — faces will still work', err);
    }
  }
  return { labels, backend: tf.getBackend() };
}
