/**
 * ============================================================================
 *  mobileServer.cjs — lets your PHONE browse the library over home Wi-Fi
 * ============================================================================
 *
 *  Your photos stay on the hard disk connected to your computer. When you
 *  switch on "Phone access" the desktop app starts a small web server:
 *
 *      http://<your-computer's-wifi-ip>:7777
 *
 *  The phone (Yaadein mobile app, or just Chrome/Safari) talks to it:
 *
 *      GET  /                         → the same React app (built `dist/` folder)
 *      GET  /api/ping                 → "are you there?"
 *      GET  /api/library              → photos, people, faces (no secrets)
 *      GET  /media/<kind>/<id>        → thumbnails, faces, originals (video seek OK)
 *      POST /api/photos/<id>/favorite → ♥ from your phone
 *      POST /api/people/<id>          → rename a person from your phone
 *
 *  Security: every /api and /media call must carry the 6-character pairing
 *  code shown on the desktop (header `x-yaadein-token` or `?token=`).
 *  It only listens on your local network — nothing is exposed to the internet
 *  unless you deliberately forward the port on your router (don't).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolveMedia } = require('./media.cjs');

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
};

/** All IPv4 addresses of this computer on the local network (for the QR code). */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

/**
 * @param {{store, cacheDir:string, distDir:string, port:number, onChange:Function}} opts
 * @returns {Promise<{close:Function, port:number}>}
 */
function startMobileServer({ store, cacheDir, distDir, port, onChange }) {
  const server = http.createServer(async (req, res) => {
    // CORS: the mobile app runs on "http://localhost" inside the phone,
    // which is a different origin than this server.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-yaadein-token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();

    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    const isPrivate = p.startsWith('/api/') || p.startsWith('/media/');

    if (isPrivate && p !== '/api/ping') {
      const token = req.headers['x-yaadein-token'] || url.searchParams.get('token');
      if (String(token).toUpperCase() !== store.settings.mobile.token) {
        return sendJson(res, 401, { error: 'Wrong pairing code' });
      }
    }

    try {
      // ---------------- API ----------------
      if (p === '/api/ping') return sendJson(res, 200, { app: 'Yaadein', ok: true });

      if (p === '/api/library' && req.method === 'GET') {
        const snap = store.snapshot({ includeDescriptors: false });
        delete snap.settings; // phone doesn't need desktop settings
        return sendJson(res, 200, snap);
      }

      let m = p.match(/^\/api\/photos\/([\w-]+)\/favorite$/);
      if (m && req.method === 'POST') {
        const body = await readJson(req);
        const photo = store.data.photos[m[1]];
        if (!photo) return sendJson(res, 404, { error: 'Not found' });
        photo.favorite = Boolean(body.favorite);
        store.save();
        onChange?.();
        return sendJson(res, 200, { ok: true });
      }

      m = p.match(/^\/api\/people\/([\w-]+)$/);
      if (m && req.method === 'POST') {
        const body = await readJson(req);
        const person = store.data.people[m[1]];
        if (!person) return sendJson(res, 404, { error: 'Not found' });
        if (typeof body.name === 'string') person.name = body.name.trim().slice(0, 60);
        store.save();
        onChange?.();
        return sendJson(res, 200, { ok: true });
      }

      // ---------------- Media ----------------
      m = p.match(/^\/media\/(original|thumb|preview|face)\/([\w-]+)$/);
      if (m) {
        const media = resolveMedia(store, cacheDir, m[1], m[2]);
        if (!media || !fs.existsSync(media.file)) return res.writeHead(404).end();
        return sendFile(req, res, media.file, media.mime, true);
      }

      // ---------------- Static app (SPA) ----------------
      if (req.method === 'GET') {
        const safe = path.normalize(decodeURIComponent(p)).replace(/^([/\\])+/, '');
        let file = path.join(distDir, safe);
        if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          file = path.join(distDir, 'index.html'); // single-page-app fallback
        }
        if (!fs.existsSync(file)) {
          return sendJson(res, 500, { error: 'App not built. Run "npm run build" on the computer.' });
        }
        return sendFile(req, res, file, STATIC_MIME[path.extname(file)] || 'application/octet-stream', false);
      }

      res.writeHead(404).end();
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () =>
      resolve({
        port,
        close: () => new Promise((r) => server.close(() => r())),
      })
    );
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

/**
 * Stream a file. Supports HTTP Range requests so videos can be seeked
 * (the <video> tag asks for "bytes=1000-2000" chunks).
 */
function sendFile(req, res, file, mime, cache) {
  const { size } = fs.statSync(file);
  const headers = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache ? 'private, max-age=86400' : 'no-cache',
  };
  const range = req.headers.range && req.headers.range.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  fs.createReadStream(file).pipe(res);
}

module.exports = { startMobileServer, lanAddresses };
