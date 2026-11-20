/**
 * ============================================================================
 *  google.cjs — bring photos in from Google Drive and Google Photos
 * ============================================================================
 *
 *  No Google SDK is used — just `fetch()` calls, so you can read every request
 *  like you'd read frontend API code.
 *
 *  1) SIGN-IN (OAuth 2.0 "installed app / loopback" flow, with PKCE)
 *     - We start a tiny web server on http://127.0.0.1:<random port>
 *     - Open Google's sign-in page in your normal browser
 *     - Google redirects back to our tiny server with a one-time `code`
 *     - We swap that code for tokens (access + refresh token)
 *     - The refresh token is saved so you only sign in once per account.
 *     - You can connect SEVERAL Google accounts.
 *
 *  2) GOOGLE DRIVE
 *     - Lists every image/video file in your Drive (Drive API v3)
 *     - Downloads them into  <Import folder>/Google Drive - you@gmail.com/
 *     - Already-downloaded files (same name + size) are skipped.
 *
 *  3) GOOGLE PHOTOS — IMPORTANT LIMITATION
 *     Since 31 March 2025 Google no longer lets ANY third-party app read your
 *     whole Google Photos library. The only allowed way is the "Picker API":
 *     Google opens its own picker, YOU select photos/albums, and only those are
 *     shared with the app. So the flow is:
 *        create session → open picker in browser → you pick → we poll →
 *        list picked items → download each into
 *        <Import folder>/Google Photos - you@gmail.com/
 *     For a FULL Google Photos export, use Google Takeout (takeout.google.com),
 *     unzip it to your hard disk and add that folder as a normal source —
 *     Yaadein reads Takeout's date side-car files automatically.
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { LibraryStore } = require('./store.cjs');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const SCOPES = {
  drive: 'https://www.googleapis.com/auth/drive.readonly',
  photos: 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
  identity: 'openid email',
};

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Access tokens live ~1 hour; we cache them in memory per account. */
const accessTokenCache = new Map(); // accountId -> { token, expiresAt }

/**
 * Sign in a Google account (opens the browser).
 * @param {LibraryStore} store
 * @param {(url:string)=>void} openExternal  Electron's shell.openExternal
 */
async function connectAccount(store, openExternal) {
  const { clientId, clientSecret } = store.settings.google;
  if (!clientId || !clientSecret) {
    throw new Error('Add your Google OAuth Client ID and Secret in Settings first (see README → Google setup).');
  }

  // PKCE: a random secret only this app knows, so a stolen `code` is useless.
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));

  // Start the loopback server and wait for Google to redirect to it.
  const { code, redirectUri } = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/') {
        res.writeHead(404).end();
        return;
      }
      const ok = url.searchParams.get('state') === state && url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<body style="font-family:system-ui;background:#16120f;color:#f6efe6;display:grid;place-items:center;height:100vh">
           <div style="text-align:center"><h1>${ok ? '✅ Connected to Yaadein' : '❌ Sign-in failed'}</h1>
           <p>You can close this tab and go back to the app.</p></div></body>`
      );
      server.close();
      clearTimeout(timer);
      if (ok) resolve({ code: url.searchParams.get('code'), redirectUri: `http://127.0.0.1:${port}` });
      else reject(new Error(url.searchParams.get('error') || 'Sign-in was cancelled'));
    });
    let port;
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Sign-in timed out after 5 minutes'));
    }, 5 * 60 * 1000);

    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `http://127.0.0.1:${port}`,
        response_type: 'code',
        scope: [SCOPES.identity, SCOPES.drive, SCOPES.photos].join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        access_type: 'offline', // => gives us a refresh token
        prompt: 'consent select_account', // let you pick WHICH Google account
        state,
      });
      openExternal(`${AUTH_URL}?${params}`);
    });
  });

  // Swap the one-time code for tokens.
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(tokens.error_description || tokens.error || 'Token exchange failed');

  // Who is this? (shown in the UI so you can tell your accounts apart)
  const me = await (
    await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
  ).json();

  const accounts = store.settings.google.accounts.filter((a) => a.email !== me.email);
  const account = {
    id: LibraryStore.newId('g'),
    email: me.email || 'Google account',
    refreshToken: tokens.refresh_token,
    scopes: tokens.scope,
  };
  accounts.push(account);
  store.data.settings.google.accounts = accounts;
  accessTokenCache.set(account.id, { token: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in - 60) * 1000 });
  store.save();
  return { id: account.id, email: account.email };
}

function disconnectAccount(store, accountId) {
  store.data.settings.google.accounts = store.settings.google.accounts.filter((a) => a.id !== accountId);
  accessTokenCache.delete(accountId);
  store.save();
}

/** Get a valid access token, refreshing it if it expired. */
async function getAccessToken(store, accountId) {
  const cached = accessTokenCache.get(accountId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const account = store.settings.google.accounts.find((a) => a.id === accountId);
  if (!account) throw new Error('Google account not connected');
  const { clientId, clientSecret } = store.settings.google;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: account.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Google sign-in expired for ${account.email}. Please reconnect. (${json.error})`);
  accessTokenCache.set(accountId, { token: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 });
  return json.access_token;
}

/** Download a URL straight to disk (streamed — no giant buffers). */
async function downloadTo(url, token, dest, mtime) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const tmp = dest + '.part';
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  await fsp.rename(tmp, dest);
  if (mtime) await fsp.utimes(dest, new Date(mtime), new Date(mtime)); // keep the real date
}

/** Choose a free filename inside `dir`. Returns null if the same file already exists. */
function uniqueDest(dir, name, size) {
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  let dest = path.join(dir, clean);
  let n = 1;
  while (fs.existsSync(dest)) {
    if (size && fs.statSync(dest).size === Number(size)) return null; // already downloaded
    if (!size) return null;
    const { name: b, ext } = path.parse(clean);
    dest = path.join(dir, `${b} (${n++})${ext}`);
  }
  return dest;
}

/**
 * Import every photo & video from Google Drive.
 * @returns {Promise<{folder:string, downloaded:number, skipped:number}>}
 */
async function importDrive(store, accountId, { onProgress = () => {}, signal } = {}) {
  const account = store.settings.google.accounts.find((a) => a.id === accountId);
  const token = await getAccessToken(store, accountId);
  const folder = path.join(importRoot(store), `Google Drive - ${account.email}`);
  await fsp.mkdir(folder, { recursive: true });

  // 1) List all media files (1000 per page).
  const files = [];
  let pageToken;
  do {
    const params = new URLSearchParams({
      q: "(mimeType contains 'image/' or mimeType contains 'video/') and trashed = false",
      fields: 'nextPageToken, files(id, name, size, mimeType, createdTime, imageMediaMetadata(time))',
      pageSize: '1000',
      spaces: 'drive',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || 'Could not list Drive files');
    files.push(...json.files);
    pageToken = json.nextPageToken;
    onProgress({ done: files.length, total: 0, message: `Found ${files.length} photos in Drive…` });
  } while (pageToken && !signal?.aborted);

  // 2) Download each one.
  let downloaded = 0;
  let skipped = 0;
  for (let i = 0; i < files.length && !signal?.aborted; i++) {
    const f = files[i];
    const dest = uniqueDest(folder, f.name, f.size);
    if (!dest) {
      skipped++;
    } else {
      try {
        const fresh = await getAccessToken(store, accountId); // refreshes after 1h
        await downloadTo(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, fresh, dest, f.createdTime);
        downloaded++;
      } catch (err) {
        console.warn('[drive] failed', f.name, err.message);
      }
    }
    onProgress({ done: i + 1, total: files.length, message: `Downloading ${f.name}` });
  }
  return { folder, downloaded, skipped };
}

/**
 * Google Photos Picker — step 1: create a picking session and open the picker.
 * Returns the session so the caller can poll it.
 */
async function startPhotosPicker(store, accountId, openExternal) {
  const token = await getAccessToken(store, accountId);
  const res = await fetch('https://photospicker.googleapis.com/v1/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const session = await res.json();
  if (!res.ok) throw new Error(session.error?.message || 'Could not open Google Photos picker');
  // "/autoclose" makes Google close the picker tab when you press Done.
  openExternal(`${session.pickerUri}/autoclose`);
  return session;
}

/**
 * Google Photos Picker — step 2: wait until you've pressed "Done", then
 * download everything you picked.
 */
async function finishPhotosPicker(store, accountId, session, { onProgress = () => {}, signal } = {}) {
  const account = store.settings.google.accounts.find((a) => a.id === accountId);
  const folder = path.join(importRoot(store), `Google Photos - ${account.email}`);
  await fsp.mkdir(folder, { recursive: true });

  // Poll the session until mediaItemsSet === true (Google tells us how often).
  const intervalMs = (parseFloat(session.pollingConfig?.pollInterval) || 5) * 1000;
  const deadline = Date.now() + 30 * 60 * 1000;
  onProgress({ done: 0, total: 0, message: 'Waiting for you to pick photos in the browser…' });
  for (;;) {
    if (signal?.aborted) return { folder, downloaded: 0, skipped: 0 };
    if (Date.now() > deadline) throw new Error('Picker timed out — try again.');
    await new Promise((r) => setTimeout(r, intervalMs));
    const token = await getAccessToken(store, accountId);
    const res = await fetch(`https://photospicker.googleapis.com/v1/sessions/${session.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const s = await res.json();
    if (!res.ok) throw new Error(s.error?.message || 'Picker session failed');
    if (s.mediaItemsSet) break;
  }

  // List the picked items (paged).
  const items = [];
  let pageToken;
  do {
    const token = await getAccessToken(store, accountId);
    const params = new URLSearchParams({ sessionId: session.id, pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(`https://photospicker.googleapis.com/v1/mediaItems?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || 'Could not list picked items');
    items.push(...(json.mediaItems || []));
    pageToken = json.nextPageToken;
  } while (pageToken);

  // Download originals: "=d" = image with EXIF, "=dv" = video bytes.
  let downloaded = 0;
  let skipped = 0;
  for (let i = 0; i < items.length && !signal?.aborted; i++) {
    const item = items[i];
    const file = item.mediaFile || {};
    const dest = uniqueDest(folder, file.filename || `${item.id}.jpg`);
    if (!dest) {
      skipped++;
    } else {
      try {
        const token = await getAccessToken(store, accountId);
        const suffix = item.type === 'VIDEO' ? '=dv' : '=d';
        await downloadTo(file.baseUrl + suffix, token, dest, item.createTime);
        downloaded++;
      } catch (err) {
        console.warn('[photos] failed', file.filename, err.message);
      }
    }
    onProgress({ done: i + 1, total: items.length, message: `Downloading ${file.filename || ''}` });
  }

  // Be tidy: delete the session on Google's side.
  try {
    const token = await getAccessToken(store, accountId);
    await fetch(`https://photospicker.googleapis.com/v1/sessions/${session.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* not important */
  }
  return { folder, downloaded, skipped };
}

/** Where Google downloads go. Defaults to <your Pictures>/Yaadein Imports. */
function importRoot(store) {
  if (store.settings.importFolder) return store.settings.importFolder;
  throw new Error('Choose an "Import folder" on your hard disk first (Sources page).');
}

module.exports = {
  connectAccount,
  disconnectAccount,
  importDrive,
  startPhotosPicker,
  finishPhotosPicker,
  getAccessToken,
};
