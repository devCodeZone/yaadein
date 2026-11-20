/**
 * types.ts — the shape of every piece of data in Yaadein.
 *
 * These mirror what electron/store.cjs saves in library.json.
 * If you add a field in the backend, add it here too so TypeScript helps you.
 */

/** A folder Yaadein watches: a hard-disk folder, a Takeout export, or a Google import folder. */
export interface Source {
  id: string;
  kind: 'folder' | 'takeout' | 'gdrive' | 'gphotos';
  path: string;
  label: string;
  addedAt: number;
  lastScanAt: number | null;
}

/** One object/scene the AI recognised, e.g. { name: "golden retriever", score: 0.82 } */
export interface Label {
  name: string;
  score: number;
}

export interface Photo {
  id: string;
  path: string; // full path on disk
  name: string; // file name
  folder: string; // parent folder path
  ext: string; // ".jpg"
  type: 'image' | 'video';
  sourceId: string;
  size: number; // bytes
  mtime: number; // file modified time (ms)
  takenAt: number; // best-known date the photo was taken (ms)
  dateSource: 'exif' | 'takeout' | 'filename' | 'file';
  width: number | null;
  height: number | null;
  camera: string | null;
  gps: { lat: number; lng: number } | null;
  fingerprint: string;
  hasThumb: boolean;
  hasPreview: boolean;
  aiDone: boolean;
  labels: Label[];
  categories: string[]; // friendly groups, e.g. "Dogs", "Food", "Nature"
  faceIds: string[];
  favorite: boolean;
}

/** A face found in a photo. `box` values are 0..1 fractions of the image size. */
export interface Face {
  id: string;
  photoId: string;
  personId: string | null;
  box: { x: number; y: number; w: number; h: number };
  score: number;
  descriptor?: number[]; // 128 numbers describing the face (desktop only)
  manual?: boolean; // you removed it from a person → don't auto-group again
}

export interface Person {
  id: string;
  name: string; // "" until you name them
  coverFaceId: string;
  hidden?: boolean;
  createdAt: number;
}

export interface GoogleAccount {
  id: string;
  email: string;
  scopes: string;
}

export interface Settings {
  theme: 'dark' | 'light';
  aiEnabled: boolean;
  faceMatchThreshold: number;
  organizeTarget: string;
  importFolder: string;
  google: { clientId: string; hasClientSecret: boolean; accounts: GoogleAccount[] };
  mobile: { port: number; token: string; autoStart: boolean };
}

/** Everything the app loads at start. */
export interface Library {
  sources: Source[];
  photos: Photo[];
  faces: Face[];
  people: Person[];
  settings?: Settings; // absent on the phone
}

/** Progress of a long task, streamed from the backend. */
export interface JobProgress {
  id: number;
  title: string;
  done?: number;
  total?: number;
  message?: string;
  finished?: boolean;
  error?: string;
}

export type OrganizeStyle = 'date' | 'year' | 'people' | 'things' | 'source';

export interface OrganizeOp {
  photoId: string;
  from: string;
  to: string;
}

export interface OrganizePlan {
  ops: OrganizeOp[];
  skipped: number;
  action: 'copy' | 'move';
  style: OrganizeStyle | 'duplicates';
  target: string;
}

export interface OrganizeHistoryItem {
  id: string;
  at: number;
  action: 'copy' | 'move';
  style: string;
  target: string;
  label: string;
  count: number;
  undone?: boolean;
  errors: { from: string; to: string; error: string }[];
}

export interface DuplicateGroup {
  hash: string;
  size: number;
  photoIds: string[];
}

export interface MobileStatus {
  running: boolean;
  port: number;
  token: string;
  addresses: string[];
  built: boolean;
}

export type MediaKind = 'thumb' | 'preview' | 'original' | 'face';
