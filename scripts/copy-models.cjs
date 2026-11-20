/**
 * copy-models.cjs — runs automatically after `npm install`.
 * Copies the 3 face models we use from node_modules into public/models/face
 * so they ship inside the app and work offline.
 */
const fs = require('fs');
const path = require('path');

const from = path.join(__dirname, '..', 'node_modules', '@vladmandic', 'face-api', 'model');
const to = path.join(__dirname, '..', 'public', 'models', 'face');
const wanted = ['ssd_mobilenetv1_model', 'face_landmark_68_model', 'face_recognition_model'];

fs.mkdirSync(to, { recursive: true });
let n = 0;
for (const name of wanted) {
  for (const ext of ['-weights_manifest.json', '.bin']) {
    const file = name + ext;
    if (fs.existsSync(path.join(from, file))) {
      fs.copyFileSync(path.join(from, file), path.join(to, file));
      n++;
    }
  }
}
console.log(`[yaadein] copied ${n} face model files → public/models/face`);
