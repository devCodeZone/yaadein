/**
 * ============================================================================
 *  store.cjs — Yaadein's tiny "database"
 * ============================================================================
 *
 *  WHY NOT A REAL DATABASE?
 *  ------------------------
 *  Real databases like SQLite need *native* modules that must be recompiled for
 *  every Electron version — a common source of "it doesn't install" pain.
 *  A photo library of even 50,000 photos is only a few MB of JSON, so we keep
 *  everything in ONE plain JavaScript object in memory and write it to disk as
 *  `library.json`. Think of it like a Redux store that persists itself.
 *
 *  SHAPE OF THE DATA (same types exist in src/api/types.ts for the UI):
 *
 *  {
 *    version: 1,
 *    sources:  [ { id, kind, path, label, addedAt, lastScanAt } ],
 *    photos:   { [photoId]: Photo },     // keyed object = O(1) lookups
 *    faces:    { [faceId]:  Face  },
 *    people:   { [personId]: Person },
 *    settings: { ... },
 *    organizeLog: [ { id, at, action, style, ops:[{photoId, from, to}] } ]
 *  }
 *
 *  SAFETY
 *  ------
 *  - Writes are "debounced" (many changes in a row => one disk write).
 *  - We write to `library.json.tmp` first and then rename it. A rename is
 *    atomic, so a crash mid-write can never leave you with a half-written file.
 *  - A rolling backup `library.backup.json` is kept from the previous session.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Default settings for a brand new install. */
function defaultSettings() {
  return {
    theme: 'dark', // 'dark' | 'light'
    aiEnabled: true, // run face + object detection in the background
    faceMatchThreshold: 0.5, // lower = stricter face grouping (0.4 – 0.6 is sane)
    organizeTarget: '', // last used "organize into" folder on your hard disk
    importFolder: '', // where Google Drive / Google Photos downloads are saved
    google: {
      clientId: '', // from Google Cloud Console (see README)
      clientSecret: '',
      accounts: [], // [{ id, email, refreshToken, scopes }]
    },
    mobile: {
      port: 7777,
      // 6-character pairing code the phone must send. Generated once.
      token: crypto.randomBytes(3).toString('hex').toUpperCase(),
      autoStart: false,
    },
  };
}

function emptyLibrary() {
  return {
    version: 1,
    sources: [],
    photos: {},
    faces: {},
    people: {},
    settings: defaultSettings(),
    organizeLog: [],
  };
}

class LibraryStore {
  /**
   * @param {string} dir Folder where library.json lives
   *                     (Electron's per-user "userData" folder in the real app).
   */
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'library.json');
    this.saveTimer = null;
    fs.mkdirSync(dir, { recursive: true });
    this.data = this.load();
  }

  /** Read library.json from disk (or start fresh). */
  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      // Keep a backup of the last good file before we start changing things.
      fs.copyFileSync(this.file, path.join(this.dir, 'library.backup.json'));
      // Merge with defaults so new settings added in later versions exist.
      const base = emptyLibrary();
      return {
        ...base,
        ...parsed,
        settings: {
          ...base.settings,
          ...parsed.settings,
          google: { ...base.settings.google, ...(parsed.settings?.google || {}) },
          mobile: { ...base.settings.mobile, ...(parsed.settings?.mobile || {}) },
        },
      };
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('[store] could not read library, starting fresh', err);
      return emptyLibrary();
    }
  }

  /**
   * Ask for a save "soon". Calling this 1,000 times in a second
   * results in a single write ~800ms after the last call.
   */
  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 800);
  }

  /** Write immediately (used on app quit). */
  flush() {
    clearTimeout(this.saveTimer);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file); // atomic replace
  }

  // ---------------------------------------------------------------------------
  //  Small helpers so other files don't poke into `data` directly everywhere.
  // ---------------------------------------------------------------------------

  /** Short random id like "p_1a2b3c4d5e". */
  static newId(prefix) {
    return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
  }

  get settings() {
    return this.data.settings;
  }

  updateSettings(patch) {
    this.data.settings = deepMerge(this.data.settings, patch);
    this.save();
    return this.data.settings;
  }

  /**
   * Everything the UI needs, in one object. Face descriptors (128 numbers per
   * face) are included because face grouping runs in the UI process.
   * Google refresh tokens are stripped — the UI never needs secrets.
   */
  snapshot({ includeDescriptors = true } = {}) {
    const { settings } = this.data;
    const safeSettings = {
      ...settings,
      google: {
        clientId: settings.google.clientId,
        hasClientSecret: Boolean(settings.google.clientSecret),
        accounts: settings.google.accounts.map((a) => ({ id: a.id, email: a.email, scopes: a.scopes })),
      },
    };
    let faces = this.data.faces;
    if (!includeDescriptors) {
      faces = {};
      for (const [id, f] of Object.entries(this.data.faces)) {
        const { descriptor, ...rest } = f; // eslint-disable-line no-unused-vars
        faces[id] = rest;
      }
    }
    return {
      sources: this.data.sources,
      photos: Object.values(this.data.photos),
      faces: Object.values(faces),
      people: Object.values(this.data.people),
      settings: safeSettings,
    };
  }
}

/** Recursively merge plain objects (arrays are replaced, not merged). */
function deepMerge(target, patch) {
  const out = { ...target };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof out[key] === 'object') {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

module.exports = { LibraryStore, emptyLibrary, deepMerge };
