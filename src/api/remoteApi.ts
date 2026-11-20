/**
 * remoteApi.ts — phone implementation of YaadeinApi.
 *
 * The phone has no hard disk access; it asks the desktop app over Wi-Fi.
 * Connection details (server address + pairing code) are kept in localStorage.
 *
 * Two ways the phone gets them:
 *  1. You open  http://<computer-ip>:7777/?code=AB12CD  in the phone browser
 *     (or scan the QR code on the desktop "Phone" page) → saved automatically.
 *  2. In the installed mobile app you type them on the Connect screen.
 */
import type { YaadeinApi } from './client';

const KEY = 'yaadein.remote';

export interface RemoteConfig {
  server: string; // e.g. "http://192.168.1.20:7777"
  token: string; // pairing code
}

export function getRemoteConfig(): RemoteConfig | null {
  // A ?code= in the address bar wins (that's what the QR code contains).
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (code && /^https?:/.test(window.location.origin)) {
    const cfg = { server: window.location.origin, token: code.toUpperCase() };
    saveRemoteConfig(cfg);
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    return cfg;
  }
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveRemoteConfig(cfg: RemoteConfig | null) {
  if (cfg) localStorage.setItem(KEY, JSON.stringify({ server: cfg.server.replace(/\/+$/, ''), token: cfg.token.toUpperCase() }));
  else localStorage.removeItem(KEY);
}

/** Quick check used by the Connect screen. */
export async function testRemote(cfg: RemoteConfig): Promise<boolean> {
  const res = await fetch(`${cfg.server.replace(/\/+$/, '')}/api/library`, { headers: { 'x-yaadein-token': cfg.token } });
  return res.ok;
}

export function createRemoteApi(): YaadeinApi {
  const cfg = () => getRemoteConfig();

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const c = cfg();
    if (!c) throw new Error('Not connected to your computer');
    const res = await fetch(c.server + path, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-yaadein-token': c.token, ...(init.headers || {}) },
    });
    if (!res.ok) throw new Error(res.status === 401 ? 'Wrong pairing code' : `Server error ${res.status}`);
    return res.json();
  }

  return {
    mode: 'remote',
    getLibrary: () => request('/api/library'),
    // <img> can't send headers, so the code goes in the query string.
    mediaUrl: (kind, id) => {
      const c = cfg();
      return c ? `${c.server}/media/${kind}/${id}?token=${c.token}` : '';
    },
    // No push channel over plain HTTP: poll every 30s instead.
    onLibraryChanged: (cb) => {
      const t = setInterval(cb, 30_000);
      return () => clearInterval(t);
    },
    onJobProgress: () => () => {},
    setFavorite: async (ids, favorite) => {
      for (const id of ids) await request(`/api/photos/${id}/favorite`, { method: 'POST', body: JSON.stringify({ favorite }) });
    },
    renamePerson: async (id, name) => {
      await request(`/api/people/${id}`, { method: 'POST', body: JSON.stringify({ name }) });
    },
    desktop: undefined,
  };
}
