/**
 * electronApi.ts — desktop implementation of YaadeinApi.
 *
 * Every method is a one-liner that calls a channel handled in electron/main.cjs.
 * Search main.cjs for the channel name (e.g. 'sources:add') to see the backend side.
 */
import type { DesktopApi, YaadeinApi } from './client';

type Bridge = NonNullable<Window['yaadein']>;

export function createElectronApi(bridge: Bridge): YaadeinApi {
  const call = <T = void>(channel: string, payload?: unknown) => bridge.invoke<T>(channel, payload);

  const desktop: DesktopApi = {
    updateSettings: (patch) => call('settings:update', patch),
    pickFolder: (title) => call('dialog:pickFolder', { title }),
    addSource: (path, kind = 'folder', label) => call('sources:add', { path, kind, label }),
    removeSource: (id) => call('sources:remove', { id }),
    rescan: (id) => call('sources:rescan', { id }),

    saveMedia: (kind, id, bytes, size) => call('media:save', { kind, id, bytes: new Uint8Array(bytes), ...size }),
    saveAi: (result) => call('ai:save', result),
    resetAi: () => call('ai:reset'),
    applyPeople: (people, assignments) => call('people:apply', { people, assignments }),
    updatePerson: (id, patch) => call('person:update', { id, ...patch }),
    mergePeople: (fromIds, intoId) => call('people:merge', { fromIds, intoId }),
    removeFaceFromPerson: (faceId) => call('face:removeFromPerson', { faceId }),

    planOrganize: (opts) => call('organize:plan', opts),
    applyPlan: (plan) => call('organize:apply', plan),
    undo: (batchId) => call('organize:undo', { batchId }),
    history: () => call('organize:history'),
    findDuplicates: () => call('dupes:find'),
    resolveDuplicates: (selections) => call('dupes:apply', { selections }),

    googleConnect: () => call('google:connect'),
    googleDisconnect: (accountId) => call('google:disconnect', { accountId }),
    importDrive: (accountId) => call('google:importDrive', { accountId }),
    importPhotos: (accountId) => call('google:importPhotos', { accountId }),

    mobileStart: () => call('mobile:start'),
    mobileStop: () => call('mobile:stop'),
    mobileStatus: () => call('mobile:status'),

    reveal: (photoId) => call('shell:reveal', { photoId }),
    openExternal: (url) => call('shell:open', { url }),
  };

  return {
    mode: 'desktop',
    getLibrary: () => call('library:get'),
    // Served by the custom protocol registered in main.cjs
    mediaUrl: (kind, id) => `yaadein://${kind}/${id}`,
    onLibraryChanged: (cb) => bridge.on('library:changed', cb),
    onJobProgress: (cb) => bridge.on('job:progress', cb),
    setFavorite: (ids, favorite) => call('photo:favorite', { ids, favorite }),
    renamePerson: (id, name) => call('person:update', { id, name }),
    desktop,
  };
}
