/**
 * ============================================================================
 *  main.cjs — Electron "main process" (the Node.js side of the desktop app)
 * ============================================================================
 *
 *  If you know frontend, think of it like this:
 *    • src/  (React)       = the website the user sees  ("renderer process")
 *    • electron/ (Node.js) = a private backend that runs on the same computer
 *                            and is allowed to touch files, disks and Google.
 *  They talk through IPC ("inter-process communication") — basically
 *  `await window.yaadein.invoke('channel', payload)` from React, handled by
 *  `ipcMain.handle('channel', ...)` below. It feels like calling an API.
 *
 *  This file:
 *    1. Creates the app window.
 *    2. Registers the `yaadein://` protocol that serves the app + photos.
 *    3. Wires every IPC channel to the modules that do the work.
 *    4. Runs long tasks ("jobs") and streams progress to the UI.
 */

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const { LibraryStore } = require('./store.cjs');
const { scanSource } = require('./scanner.cjs');
const organizer = require('./organizer.cjs');
const google = require('./google.cjs');
const { resolveMedia, CACHE_FOLDERS } = require('./media.cjs');
const { startMobileServer, lanAddresses } = require('./mobileServer.cjs');

// ---------------------------------------------------------------------------
//  Paths
// ---------------------------------------------------------------------------
// YAADEIN_DATA_DIR lets you run a separate "test" library: handy while coding.
const DATA_DIR = process.env.YAADEIN_DATA_DIR || app.getPath('userData');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const DIST_DIR = path.join(__dirname, '..', 'dist'); // built React app
const DEV_URL = process.env.VITE_DEV_SERVER_URL; // set by `npm run dev`

for (const sub of Object.values(CACHE_FOLDERS)) fs.mkdirSync(path.join(CACHE_DIR, sub), { recursive: true });

/** @type {LibraryStore} */
let store;
/** @type {BrowserWindow} */
let win;
let mobile = null; // running phone server, if any

// ---------------------------------------------------------------------------
//  The yaadein:// protocol
// ---------------------------------------------------------------------------
// Must be declared before the app is ready. "standard + secure" makes it behave
// like https:// so fetch(), workers, WebGL and <video> all work normally.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'yaadein',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
]);

function registerProtocol() {
  protocol.handle('yaadein', async (request) => {
    const url = new URL(request.url);
    const kind = url.hostname; // yaadein://<kind>/<id>

    // yaadein://app/...  → files of the built React app (production mode)
    if (kind === 'app') {
      let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      let file = path.join(DIST_DIR, rel);
      if (!file.startsWith(DIST_DIR)) return new Response('Forbidden', { status: 403 });
      if (!fs.existsSync(file)) {
        // Missing asset (has an extension) → 404. Anything else → the SPA page.
        if (path.extname(rel)) return new Response('Not found', { status: 404 });
        file = path.join(DIST_DIR, 'index.html');
      }
      return net.fetch(pathToFileURL(file).toString());
    }

    // yaadein://thumb/<id>, /original/<id>, /preview/<id>, /face/<id>
    const media = resolveMedia(store, CACHE_DIR, kind, url.pathname.slice(1));
    if (!media || !fs.existsSync(media.file)) return new Response('Not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(media.file).toString(), {
      headers: request.headers, // forwards "Range" so videos can seek
      bypassCustomProtocolHandlers: true,
    });
    // Allow the UI (different origin in dev) to read pixels for AI processing.
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Content-Type', media.mime);
    headers.set('Cache-Control', kind === 'original' ? 'no-cache' : 'max-age=31536000');
    return new Response(res.body, { status: res.status, headers });
  });
}

// ---------------------------------------------------------------------------
//  Window
// ---------------------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#14100d',
    title: 'Yaadein',
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, // UI can't reach Node directly
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (DEV_URL) win.loadURL(DEV_URL); // hot-reload Vite dev server
  else win.loadURL('yaadein://app/index.html'); // built app

  // Links like "Open in Google Maps" open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/** Send an event to the UI (if the window is still open). */
function emit(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

// Tell the UI "data changed, refetch" — but at most every 1.5s.
let changeTimer = null;
function libraryChanged() {
  if (changeTimer) return;
  changeTimer = setTimeout(() => {
    changeTimer = null;
    emit('library:changed');
  }, 1500);
}

// ---------------------------------------------------------------------------
//  Jobs: long-running tasks with progress (scans, imports, organizing…)
// ---------------------------------------------------------------------------
let jobCounter = 0;
let jobChain = Promise.resolve(); // jobs run one after another (disk friendly)

/**
 * Run `fn` as a job. The UI receives `job:progress` events for a progress toast.
 * Returns a promise with fn's result.
 */
function runJob(title, fn) {
  const id = ++jobCounter;
  const report = (p = {}) => emit('job:progress', { id, title, ...p });
  report({ done: 0, total: 0, message: 'Waiting…' });
  const result = jobChain.then(async () => {
    try {
      const value = await fn(report);
      report({ finished: true, message: 'Done' });
      return value;
    } catch (err) {
      report({ finished: true, error: err.message });
      throw err;
    } finally {
      libraryChanged();
    }
  });
  jobChain = result.catch(() => {}); // a failed job must not block the next one
  return result;
}

function scanJob(source) {
  return runJob(`Scanning ${source.label}`, async (report) => {
    let last = 0;
    const stats = await scanSource(store, source, {
      onProgress: (p) => {
        report(p);
        // Let the grid fill in while a big disk is still being scanned.
        if (p.done - last >= 1000) {
          last = p.done;
          store.save();
          libraryChanged();
        }
      },
    });
    pruneEmptyPeople();
    return stats;
  });
}

/** Add a folder as a source (or return the existing one) and scan it. */
function ensureSource(folder, kind, label) {
  let source = store.data.sources.find((s) => path.resolve(s.path) === path.resolve(folder));
  if (!source) {
    source = {
      id: LibraryStore.newId('s'),
      kind, // 'folder' | 'takeout' | 'gdrive' | 'gphotos'
      path: folder,
      label: label || path.basename(folder) || folder,
      addedAt: Date.now(),
      lastScanAt: null,
    };
    store.data.sources.push(source);
    store.save();
  }
  scanJob(source).catch(() => {});
  return source;
}

/** People with no faces left (e.g. after deleting photos) are removed. */
function pruneEmptyPeople() {
  const used = new Set(Object.values(store.data.faces).map((f) => f.personId));
  for (const id of Object.keys(store.data.people)) if (!used.has(id)) delete store.data.people[id];
}

/** Remove photo records (NOT files) together with their faces. */
function forgetPhotos(ids) {
  for (const id of ids) {
    const photo = store.data.photos[id];
    if (!photo) continue;
    for (const faceId of photo.faceIds) delete store.data.faces[faceId];
    delete store.data.photos[id];
  }
  pruneEmptyPeople();
  store.save();
}

// ---------------------------------------------------------------------------
//  IPC handlers — each one is like an API endpoint for the React app
// ---------------------------------------------------------------------------
function registerIpc() {
  const handle = (channel, fn) => ipcMain.handle(channel, (_event, payload) => fn(payload || {}));

  // ---- Library & settings -------------------------------------------------
  handle('library:get', () => store.snapshot());
  handle('settings:update', (patch) => {
    store.updateSettings(patch);
    return store.snapshot().settings;
  });

  handle('dialog:pickFolder', async ({ title }) => {
    const r = await dialog.showOpenDialog(win, { title: title || 'Choose a folder', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  // ---- Sources (folders / disks) ------------------------------------------
  handle('sources:add', ({ path: folder, kind = 'folder', label }) => {
    if (!folder || !fs.existsSync(folder)) throw new Error('That folder does not exist (is the disk connected?)');
    return ensureSource(folder, kind, label);
  });
  handle('sources:remove', ({ id }) => {
    // Only forgets the photos inside Yaadein — your files are NOT touched.
    const ids = Object.values(store.data.photos).filter((p) => p.sourceId === id).map((p) => p.id);
    forgetPhotos(ids);
    store.data.sources = store.data.sources.filter((s) => s.id !== id);
    store.save();
    libraryChanged();
    return true;
  });
  handle('sources:rescan', ({ id }) => {
    const list = id ? store.data.sources.filter((s) => s.id === id) : store.data.sources;
    for (const s of list) {
      if (fs.existsSync(s.path)) scanJob(s).catch(() => {});
    }
    return true;
  });

  // ---- Media made by the UI's background processor -------------------------
  // The UI decodes each photo once, makes a thumbnail (+ preview for HEIC,
  // + face crops) and sends the JPEG bytes here to be cached on disk.
  handle('media:save', ({ kind, id, bytes, width, height }) => {
    const folder = CACHE_FOLDERS[kind];
    if (!folder || !/^[\w-]+$/.test(id)) throw new Error('bad media request');
    fs.writeFileSync(path.join(CACHE_DIR, folder, `${id}.jpg`), Buffer.from(bytes));
    const photo = store.data.photos[id];
    if (photo && kind === 'thumb') {
      photo.hasThumb = true;
      if (width && height) Object.assign(photo, { width, height });
    }
    if (photo && kind === 'preview') photo.hasPreview = true;
    store.save();
    return true;
  });

  // Results of face + object detection for one photo.
  handle('ai:save', ({ photoId, labels, categories, faces }) => {
    const photo = store.data.photos[photoId];
    if (!photo) return false;
    for (const old of photo.faceIds) delete store.data.faces[old];
    photo.labels = labels;
    photo.categories = categories;
    photo.faceIds = faces.map((f) => f.id);
    for (const f of faces) store.data.faces[f.id] = { ...f, photoId, personId: null };
    photo.aiDone = true;
    store.save();
    return true;
  });

  // Forget all AI results so everything gets re-analysed.
  handle('ai:reset', () => {
    store.data.faces = {};
    store.data.people = {};
    for (const p of Object.values(store.data.photos)) Object.assign(p, { aiDone: false, faceIds: [], labels: [], categories: [] });
    store.save();
    libraryChanged();
    return true;
  });

  // ---- People ---------------------------------------------------------------
  // Face grouping runs in the UI (src/ai/clusterFaces.ts); it sends the result.
  handle('people:apply', ({ people = [], assignments = {} }) => {
    for (const person of people) store.data.people[person.id] = { ...store.data.people[person.id], ...person };
    for (const [faceId, personId] of Object.entries(assignments)) {
      if (store.data.faces[faceId]) store.data.faces[faceId].personId = personId;
    }
    pruneEmptyPeople();
    store.save();
    return true;
  });
  handle('person:update', ({ id, ...patch }) => {
    const person = store.data.people[id];
    if (!person) throw new Error('Person not found');
    if (typeof patch.name === 'string') person.name = patch.name.trim().slice(0, 60);
    if (typeof patch.hidden === 'boolean') person.hidden = patch.hidden;
    if (typeof patch.coverFaceId === 'string') person.coverFaceId = patch.coverFaceId;
    store.save();
    return person;
  });
  handle('people:merge', ({ fromIds, intoId }) => {
    for (const face of Object.values(store.data.faces)) {
      if (fromIds.includes(face.personId)) face.personId = intoId;
    }
    for (const id of fromIds) if (id !== intoId) delete store.data.people[id];
    store.save();
    return true;
  });
  handle('face:removeFromPerson', ({ faceId }) => {
    const face = store.data.faces[faceId];
    if (face) Object.assign(face, { personId: null, manual: true }); // manual = don't auto-regroup
    pruneEmptyPeople();
    store.save();
    return true;
  });

  handle('photo:favorite', ({ ids, favorite }) => {
    for (const id of ids) if (store.data.photos[id]) store.data.photos[id].favorite = favorite;
    store.save();
    return true;
  });

  // ---- Organize on disk -----------------------------------------------------
  handle('organize:plan', (opts) => {
    const plan = organizer.planOrganize(store, opts);
    if (opts.target) store.updateSettings({ organizeTarget: opts.target });
    return plan;
  });
  handle('organize:apply', (plan) =>
    runJob(`${plan.action === 'move' ? 'Moving' : 'Copying'} ${plan.ops.length} files`, async (report) => {
      const result = await organizer.applyPlan(store, plan, { onProgress: report });
      if (plan.style === 'duplicates') forgetPhotos(plan.ops.map((o) => o.photoId));
      return result;
    })
  );
  handle('organize:undo', ({ batchId }) =>
    runJob('Undoing', async (report) => {
      const batch = store.data.organizeLog.find((b) => b.id === batchId);
      const result = await organizer.undoBatch(store, batchId, { onProgress: report });
      // Duplicates were removed from the library, so rescan to bring them back.
      if (batch?.style === 'duplicates') for (const s of store.data.sources) scanJob(s).catch(() => {});
      return result;
    })
  );
  handle('organize:history', () =>
    store.data.organizeLog.map(({ ops, ...b }) => ({ ...b, count: ops.length }))
  );

  handle('dupes:find', () => runJob('Finding duplicates', (report) => organizer.findDuplicates(store, { onProgress: report })));
  handle('dupes:apply', ({ selections }) => {
    const plan = organizer.planDuplicateMoves(store, selections);
    return runJob(`Moving ${plan.ops.length} duplicates aside`, async (report) => {
      const result = await organizer.applyPlan(store, plan, { onProgress: report, label: 'Duplicates moved to _Duplicates' });
      forgetPhotos(plan.ops.map((o) => o.photoId));
      return result;
    });
  });

  // ---- Google ----------------------------------------------------------------
  handle('google:connect', () => google.connectAccount(store, (url) => shell.openExternal(url)));
  handle('google:disconnect', ({ accountId }) => {
    google.disconnectAccount(store, accountId);
    return true;
  });
  handle('google:importDrive', ({ accountId }) =>
    runJob('Importing from Google Drive', async (report) => {
      const result = await google.importDrive(store, accountId, { onProgress: report });
      ensureSource(result.folder, 'gdrive', path.basename(result.folder));
      return result;
    })
  );
  handle('google:importPhotos', async ({ accountId }) => {
    const session = await google.startPhotosPicker(store, accountId, (url) => shell.openExternal(url));
    return runJob('Importing from Google Photos', async (report) => {
      const result = await google.finishPhotosPicker(store, accountId, session, { onProgress: report });
      ensureSource(result.folder, 'gphotos', path.basename(result.folder));
      return result;
    });
  });

  // ---- Phone access ------------------------------------------------------------
  handle('mobile:start', async () => {
    if (!mobile) {
      mobile = await startMobileServer({
        store,
        cacheDir: CACHE_DIR,
        distDir: DIST_DIR,
        port: store.settings.mobile.port,
        onChange: libraryChanged,
      });
    }
    store.updateSettings({ mobile: { autoStart: true } });
    return mobileStatus();
  });
  handle('mobile:stop', async () => {
    if (mobile) await mobile.close();
    mobile = null;
    store.updateSettings({ mobile: { autoStart: false } });
    return mobileStatus();
  });
  handle('mobile:status', () => mobileStatus());

  // ---- Shell helpers -----------------------------------------------------------
  handle('shell:reveal', ({ photoId }) => {
    const photo = store.data.photos[photoId];
    if (photo) shell.showItemInFolder(photo.path);
    return true;
  });
  handle('shell:open', ({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return true;
  });
}

function mobileStatus() {
  return {
    running: Boolean(mobile),
    port: store.settings.mobile.port,
    token: store.settings.mobile.token,
    addresses: lanAddresses(),
    built: fs.existsSync(path.join(DIST_DIR, 'index.html')),
  };
}

// ---------------------------------------------------------------------------
//  App lifecycle
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit(); // a second copy was opened — focus the first one instead
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    store = new LibraryStore(DATA_DIR);
    registerProtocol();
    registerIpc();
    createWindow();

    // Restart phone access if it was on last time.
    if (store.settings.mobile.autoStart) {
      try {
        mobile = await startMobileServer({ store, cacheDir: CACHE_DIR, distDir: DIST_DIR, port: store.settings.mobile.port, onChange: libraryChanged });
      } catch (err) {
        console.warn('[mobile] could not start', err.message);
      }
    }
    // Pick up new photos added while the app was closed.
    for (const s of store.data.sources) if (fs.existsSync(s.path)) scanJob(s).catch(() => {});
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => store?.flush());
}
