/**
 * useLibrary.ts — global app state with Zustand.
 *
 * Zustand is a ~1KB alternative to Redux: you call `create()` with your state
 * and functions, and any component can do
 *
 *     const photos = useLibrary((s) => s.photos);
 *
 * The component re-renders only when *that slice* changes.
 *
 * Besides the raw arrays we build lookup maps ("indexes") once, so components
 * can do `photosById.get(id)` instead of searching arrays every render.
 */
import { create } from 'zustand';
import { api } from '../api/client';
import type { Face, JobProgress, Library, Person, Photo, Settings, Source } from '../api/types';

export interface AiStatus {
  running: boolean;
  paused: boolean;
  done: number;
  total: number;
  current?: string;
  error?: string;
  labelsAvailable: boolean; // false if the object model couldn't load (offline)
}

interface LibraryState {
  loaded: boolean;
  error: string | null;
  sources: Source[];
  photos: Photo[]; // sorted newest first
  faces: Face[];
  people: Person[];
  settings: Settings | null;

  // indexes (rebuilt whenever data changes)
  photosById: Map<string, Photo>;
  facesById: Map<string, Face>;
  peopleById: Map<string, Person>;
  /** personId → ids of photos that person appears in */
  photoIdsByPerson: Map<string, string[]>;

  jobs: Record<number, JobProgress>;
  ai: AiStatus;

  load(): Promise<void>;
  /** Merge small changes into photos locally (used by the AI processor). */
  patchPhotos(patches: Record<string, Partial<Photo>>): void;
  addFaces(faces: Face[]): void;
  setPeopleState(people: Person[], faces: Face[]): void;
  setFavorite(ids: string[], favorite: boolean): Promise<void>;
  renamePerson(id: string, name: string): Promise<void>;
  setSettings(settings: Settings): void;
  setJob(p: JobProgress): void;
  setAi(patch: Partial<AiStatus>): void;
}

/** Build the lookup maps from raw arrays. */
function buildIndexes(photos: Photo[], faces: Face[], people: Person[]) {
  const photosById = new Map(photos.map((p) => [p.id, p]));
  const facesById = new Map(faces.map((f) => [f.id, f]));
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const photoIdsByPerson = new Map<string, string[]>();
  for (const f of faces) {
    if (!f.personId) continue;
    const list = photoIdsByPerson.get(f.personId) || [];
    if (list[list.length - 1] !== f.photoId) list.push(f.photoId);
    photoIdsByPerson.set(f.personId, list);
  }
  // remove repeated photo ids (two faces of one person in one photo)
  for (const [k, v] of photoIdsByPerson) photoIdsByPerson.set(k, [...new Set(v)]);
  return { photosById, facesById, peopleById, photoIdsByPerson };
}

const byNewest = (a: Photo, b: Photo) => b.takenAt - a.takenAt;

export const useLibrary = create<LibraryState>((set, get) => ({
  loaded: false,
  error: null,
  sources: [],
  photos: [],
  faces: [],
  people: [],
  settings: null,
  photosById: new Map(),
  facesById: new Map(),
  peopleById: new Map(),
  photoIdsByPerson: new Map(),
  jobs: {},
  ai: { running: false, paused: false, done: 0, total: 0, labelsAvailable: true },

  async load() {
    try {
      const lib: Library = await api.getLibrary();
      const photos = [...lib.photos].sort(byNewest);
      set({
        loaded: true,
        error: null,
        sources: lib.sources,
        photos,
        faces: lib.faces,
        people: lib.people,
        settings: lib.settings || get().settings,
        ...buildIndexes(photos, lib.faces, lib.people),
      });
    } catch (err) {
      set({ loaded: true, error: (err as Error).message });
    }
  },

  patchPhotos(patches) {
    const photos = get().photos.map((p) => (patches[p.id] ? { ...p, ...patches[p.id] } : p));
    set({ photos, ...buildIndexes(photos, get().faces, get().people) });
  },

  addFaces(newFaces) {
    const ids = new Set(newFaces.map((f) => f.id));
    const faces = [...get().faces.filter((f) => !ids.has(f.id)), ...newFaces];
    set({ faces, ...buildIndexes(get().photos, faces, get().people) });
  },

  setPeopleState(people, faces) {
    set({ people, faces, ...buildIndexes(get().photos, faces, people) });
  },

  async setFavorite(ids, favorite) {
    // Optimistic update: change the UI first, then tell the backend.
    get().patchPhotos(Object.fromEntries(ids.map((id) => [id, { favorite }])));
    await api.setFavorite(ids, favorite);
  },

  async renamePerson(id, name) {
    const people = get().people.map((p) => (p.id === id ? { ...p, name } : p));
    set({ people, peopleById: new Map(people.map((p) => [p.id, p])) });
    await api.renamePerson(id, name);
  },

  setSettings(settings) {
    set({ settings });
  },

  setJob(p) {
    set({ jobs: { ...get().jobs, [p.id]: { ...get().jobs[p.id], ...p } } });
    // Finished toasts disappear after a few seconds.
    if (p.finished) {
      setTimeout(() => {
        const { [p.id]: _gone, ...rest } = get().jobs; // eslint-disable-line @typescript-eslint/no-unused-vars
        set({ jobs: rest });
      }, p.error ? 9000 : 3500);
    }
  },

  setAi(patch) {
    set({ ai: { ...get().ai, ...patch } });
  },
}));

/** Display name for a person ("Riya" or "Unnamed"). */
export function personName(p?: Person | null) {
  return p?.name?.trim() || 'Add a name';
}
