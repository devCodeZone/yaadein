/**
 * preload.cjs — the ONLY bridge between the React UI and Node.js.
 *
 * Electron security model in one paragraph:
 *   The UI (renderer) is a normal web page with NO access to Node or your
 *   files. The main process (main.cjs) has full access. This preload script
 *   runs before the page loads and exposes a tiny, explicit API on
 *   `window.yaadein`. The UI can only call the channels listed below.
 *
 * In the UI you'll find the typed wrapper around this in src/api/electronApi.ts.
 */

const { contextBridge, ipcRenderer } = require('electron');

/** Request/response channels the UI may call (ipcRenderer.invoke). */
const INVOKE_CHANNELS = new Set([
  'library:get',
  'settings:update',
  'dialog:pickFolder',
  'sources:add',
  'sources:remove',
  'sources:rescan',
  'media:save',
  'ai:save',
  'ai:reset',
  'people:apply',
  'people:merge',
  'person:update',
  'face:removeFromPerson',
  'photo:favorite',
  'organize:plan',
  'organize:apply',
  'organize:undo',
  'organize:history',
  'dupes:find',
  'dupes:apply',
  'google:connect',
  'google:disconnect',
  'google:importDrive',
  'google:importPhotos',
  'mobile:start',
  'mobile:stop',
  'mobile:status',
  'shell:reveal',
  'shell:open',
]);

/** Events the main process pushes to the UI. */
const EVENT_CHANNELS = new Set(['job:progress', 'library:changed', 'mobile:changed']);

contextBridge.exposeInMainWorld('yaadein', {
  platform: process.platform,

  /** Call the main process and await its answer. */
  invoke(channel, payload) {
    if (!INVOKE_CHANNELS.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
    return ipcRenderer.invoke(channel, payload);
  },

  /** Subscribe to pushed events. Returns an "unsubscribe" function (like useEffect cleanup). */
  on(channel, callback) {
    if (!EVENT_CHANNELS.has(channel)) throw new Error(`Blocked event channel: ${channel}`);
    const listener = (_event, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
