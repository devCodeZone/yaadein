/**
 * download-models.cjs — OPTIONAL, run once with internet:  npm run download-models
 *
 * Saves the MobileNet v2 object-recognition model (~14 MB) into
 * public/models/mobilenet so "Things" recognition works fully offline.
 * Without it, the app downloads the same model from Google's TF Hub on first
 * use (and the browser cache keeps it).
 */
const fs = require('fs');
const path = require('path');

const BASE = 'https://tfhub.dev/google/imagenet/mobilenet_v2_100_224/classification/2';
const OUT = path.join(__dirname, '..', 'public', 'models', 'mobilenet');

async function get(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('Downloading model.json …');
  const modelRes = await get(`${BASE}/model.json?tfjs-format=file`);
  const finalBase = modelRes.url.split('?')[0].replace(/model\.json$/, ''); // TF Hub redirects (Kaggle)
  const model = await modelRes.json();
  fs.writeFileSync(path.join(OUT, 'model.json'), JSON.stringify(model));

  const shards = model.weightsManifest.flatMap((g) => g.paths);
  for (const [i, shard] of shards.entries()) {
    process.stdout.write(`Downloading weights ${i + 1}/${shards.length}\r`);
    const res = await get(`${finalBase}${shard}?tfjs-format=file`).catch(() => get(`${BASE}/${shard}?tfjs-format=file`));
    fs.writeFileSync(path.join(OUT, shard), Buffer.from(await res.arrayBuffer()));
  }
  console.log(`\n✅ Saved to ${OUT}. Rebuild the app (npm run build) to include it.`);
})().catch((err) => {
  console.error('❌ Download failed:', err.message);
  console.error('No problem — the app will download the model by itself on first run.');
  process.exit(1);
});
