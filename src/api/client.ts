/**
 * client.ts — ONE API object for the whole UI, no matter where it runs.
 *
 *   ┌──────────────────────┐        ┌──────────────────────────────┐
 *   │ Desktop (Electron)   │        │ Phone (Capacitor app/browser)│
 *   │ window.yaadein IPC   │        │ fetch() to the desktop over  │
 *   │ → electronApi.ts     │        │ Wi-Fi  → remoteApi.ts        │
 *   └─────────┬────────────┘        └──────────────┬───────────────┘
 *             └──────────── both implement ────────┘
 *                        YaadeinApi (below)
 *
 * Components just `import { api } from '../api/client'` and never care.
 * Desktop-only powers (scanning disks, organizing, Google import, AI saving)
 * live under `api.desktop`, which is `undefined` on the phone — so pages can
 * simply do `if (api.desktop) …` to show or hide those features.
 */
import type {
  DuplicateGroup,
  JobProgress,
  Library,
  MediaKind,
  MobileStatus,
  OrganizeHistoryItem,
  OrganizePlan,
  OrganizeStyle,
  Person,
  Settings,
  Source,
  Label,
  Face,
} from './types';
import { createElectronApi } from './electronApi';
import { createRemoteApi } from './remoteApi';

export interface DesktopApi {
  updateSettings(patch: Partial<Settings> | Record<string, unknown>): Promise<Settings>;
  pickFolder(title?: string): Promise<string | null>;
  addSource(path: string, kind?: Source['kind'], label?: string): Promise<Source>;
  removeSource(id: string): Promise<void>;
  rescan(id?: string): Promise<void>;

  saveMedia(kind: 'thumb' | 'preview' | 'face', id: string, bytes: ArrayBuffer, size?: { width: number; height: number }): Promise<void>;
  saveAi(result: { photoId: string; labels: Label[]; categories: string[]; faces: Face[] }): Promise<void>;
  resetAi(): Promise<void>;
  applyPeople(people: Person[], assignments: Record<string, string | null>): Promise<void>;
  updatePerson(id: string, patch: { hidden?: boolean; coverFaceId?: string }): Promise<void>;
  mergePeople(fromIds: string[], intoId: string): Promise<void>;
  removeFaceFromPerson(faceId: string): Promise<void>;

  planOrganize(opts: { style: OrganizeStyle; action: 'copy' | 'move'; target: string; photoIds?: string[]; includeUnsorted?: boolean }): Promise<OrganizePlan>;
  applyPlan(plan: OrganizePlan): Promise<{ batchId: string; done: number; errors: unknown[] }>;
  undo(batchId: string): Promise<void>;
  history(): Promise<OrganizeHistoryItem[]>;
  findDuplicates(): Promise<DuplicateGroup[]>;
  resolveDuplicates(selections: { keepId: string; photoIds: string[] }[]): Promise<void>;

  googleConnect(): Promise<{ id: string; email: string }>;
  googleDisconnect(accountId: string): Promise<void>;
  importDrive(accountId: string): Promise<{ downloaded: number; skipped: number }>;
  importPhotos(accountId: string): Promise<{ downloaded: number; skipped: number }>;

  mobileStart(): Promise<MobileStatus>;
  mobileStop(): Promise<MobileStatus>;
  mobileStatus(): Promise<MobileStatus>;

  reveal(photoId: string): Promise<void>;
  openExternal(url: string): Promise<void>;
}

export interface YaadeinApi {
  mode: 'desktop' | 'remote';
  getLibrary(): Promise<Library>;
  /** URL usable in <img src> / <video src>. */
  mediaUrl(kind: MediaKind, id: string): string;
  onLibraryChanged(cb: () => void): () => void;
  onJobProgress(cb: (p: JobProgress) => void): () => void;
  setFavorite(ids: string[], favorite: boolean): Promise<void>;
  renamePerson(id: string, name: string): Promise<void>;
  desktop?: DesktopApi;
}

/** Shape of what preload.cjs puts on window. */
declare global {
  interface Window {
    yaadein?: {
      platform: string;
      invoke<T = unknown>(channel: string, payload?: unknown): Promise<T>;
      on(channel: string, cb: (data: any) => void): () => void; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
  }
}

/** The single shared instance. */
export const api: YaadeinApi = window.yaadein ? createElectronApi(window.yaadein) : createRemoteApi();
