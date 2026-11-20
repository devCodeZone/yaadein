/**
 * search.ts — the search box + filter chips logic.
 *
 * How searching works (deliberately simple and fast):
 *   For each photo we build ONE lowercase "search text" containing everything
 *   we know about it: file name, folder, AI labels, categories, people's names,
 *   year, month, camera, "video"/"photo", "favorite".
 *
 *   Then the query "riya beach 2023" is split into words and a photo matches
 *   if EVERY word (or one of its synonyms) appears in its search text.
 *   20,000 photos × a few words = a few milliseconds.
 *
 * Filters (people, categories, year, type, favourites, source) are exact
 * matches applied on top of the text search. They live in the URL
 * (?person=…&cat=…) so Back/Forward and links just work.
 */
import type { Face, Person, Photo } from '../api/types';
import { MONTHS } from './dates';

/** Words people type → words the AI uses. */
const SYNONYMS: Record<string, string[]> = {
  beach: ['seashore', 'sandbar', 'beaches & water'],
  sea: ['seashore', 'beaches & water'],
  ocean: ['seashore', 'beaches & water'],
  water: ['beaches & water', 'lakeside'],
  lake: ['lakeside'],
  mountain: ['mountains', 'alp', 'valley', 'volcano', 'cliff'],
  mountains: ['alp', 'valley', 'volcano', 'cliff'],
  hills: ['mountains', 'alp', 'valley'],
  snow: ['alp', 'ski', 'snowmobile', 'dogsled'],
  dog: ['dogs'],
  puppy: ['dogs'],
  cat: ['cats'],
  kitten: ['cats'],
  pet: ['dogs', 'cats'],
  bird: ['birds'],
  animal: ['animals', 'dogs', 'cats', 'birds'],
  car: ['vehicles', 'sports car', 'cab', 'convertible', 'jeep'],
  bike: ['mountain bike', 'moped', 'motor scooter'],
  scooter: ['motor scooter', 'moped'],
  plane: ['airliner', 'warplane'],
  flight: ['airliner'],
  boat: ['speedboat', 'canoe', 'liner', 'gondola'],
  train: ['electric locomotive', 'steam locomotive', 'passenger car', 'bullet train', 'streetcar'],
  food: ['food'],
  pizza: ['pizza'],
  sweets: ['confectionery', 'trifle', 'ice cream', 'chocolate sauce'],
  dessert: ['ice cream', 'trifle', 'chocolate sauce', 'custard apple'],
  flower: ['flowers & plants', 'daisy'],
  flowers: ['flowers & plants', 'daisy'],
  plant: ['flowers & plants', 'pot'],
  temple: ['stupa', 'monastery', 'buildings & places'],
  church: ['church'],
  mosque: ['mosque'],
  building: ['buildings & places'],
  wedding: ['celebrations', 'groom', 'gown', 'veil'],
  party: ['celebrations', 'balloon', 'candle'],
  birthday: ['celebrations', 'balloon', 'candle', 'cake'],
  document: ['documents & screens', 'menu', 'envelope', 'web site'],
  documents: ['documents & screens'],
  receipt: ['documents & screens'],
  screenshot: ['screenshots'],
  screenshots: ['screenshots'],
  selfie: ['people'],
  people: ['people'],
  person: ['people'],
  laptop: ['laptop', 'notebook', 'electronics'],
  phone: ['cellular telephone', 'electronics'],
  sports: ['sports'],
  cricket: ['sports', 'ballplayer'],
  football: ['soccer ball', 'football helmet', 'sports'],
  fav: ['favorite'],
  favourite: ['favorite'],
  favorites: ['favorite'],
  videos: ['video'],
  photos: ['photo'],
};

export interface Filters {
  q: string;
  people: string[]; // person ids — photo must contain ALL of them
  cats: string[]; // categories — photo must have ANY of them
  year: number | null;
  type: 'image' | 'video' | null;
  fav: boolean;
  source: string | null;
  place: boolean; // only photos with GPS
}

export const EMPTY_FILTERS: Filters = { q: '', people: [], cats: [], year: null, type: null, fav: false, source: null, place: false };

/** URL search params  ⇄  Filters object */
export function filtersFromParams(p: URLSearchParams): Filters {
  return {
    q: p.get('q') || '',
    people: p.getAll('person'),
    cats: p.getAll('cat'),
    year: p.get('year') ? Number(p.get('year')) : null,
    type: (p.get('type') as Filters['type']) || null,
    fav: p.get('fav') === '1',
    source: p.get('source'),
    place: p.get('place') === '1',
  };
}

export function paramsFromFilters(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  f.people.forEach((id) => p.append('person', id));
  f.cats.forEach((c) => p.append('cat', c));
  if (f.year) p.set('year', String(f.year));
  if (f.type) p.set('type', f.type);
  if (f.fav) p.set('fav', '1');
  if (f.source) p.set('source', f.source);
  if (f.place) p.set('place', '1');
  return p;
}

export const hasActiveFilters = (f: Filters) =>
  Boolean(f.q || f.people.length || f.cats.length || f.year || f.type || f.fav || f.source || f.place);

/** Build the search text for every photo (memoise this in a component!). */
export function buildSearchIndex(photos: Photo[], facesById: Map<string, Face>, peopleById: Map<string, Person>) {
  const index = new Map<string, string>();
  for (const p of photos) {
    const d = new Date(p.takenAt);
    const names = p.faceIds
      .map((id) => facesById.get(id)?.personId)
      .map((pid) => (pid ? peopleById.get(pid)?.name : ''))
      .filter(Boolean);
    const folderBits = p.folder.split(/[\\/]/).slice(-3).join(' ');
    index.set(
      p.id,
      [
        p.name,
        folderBits,
        p.labels.map((l) => l.name).join(' '),
        p.categories.join(' '),
        names.join(' '),
        d.getFullYear(),
        MONTHS[d.getMonth()],
        p.camera || '',
        p.type === 'video' ? 'video' : 'photo',
        p.favorite ? 'favorite' : '',
        p.gps ? 'location gps' : '',
      ]
        .join(' ')
        .toLowerCase()
    );
  }
  return index;
}

/** Apply text query + filters. Returns a new (still newest-first) array. */
export function filterPhotos(
  photos: Photo[],
  f: Filters,
  index: Map<string, string>,
  facesById: Map<string, Face>
): Photo[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const variants = words.map((w) => [w, ...(SYNONYMS[w] || [])]);

  return photos.filter((p) => {
    if (f.fav && !p.favorite) return false;
    if (f.type && p.type !== f.type) return false;
    if (f.source && p.sourceId !== f.source) return false;
    if (f.place && !p.gps) return false;
    if (f.year && new Date(p.takenAt).getFullYear() !== f.year) return false;
    if (f.cats.length && !f.cats.some((c) => p.categories.includes(c))) return false;
    if (f.people.length) {
      const inPhoto = new Set(p.faceIds.map((id) => facesById.get(id)?.personId));
      if (!f.people.every((pid) => inPhoto.has(pid))) return false;
    }
    if (variants.length) {
      const text = index.get(p.id) || '';
      if (!variants.every((vs) => vs.some((v) => text.includes(v)))) return false;
    }
    return true;
  });
}

export interface Suggestion {
  kind: 'person' | 'category' | 'label' | 'year' | 'folder';
  label: string;
  value: string;
  count?: number;
  faceId?: string;
}

/** Autocomplete suggestions for the search box. */
export function suggest(
  query: string,
  photos: Photo[],
  people: Person[],
  photoIdsByPerson: Map<string, string[]>
): Suggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: Suggestion[] = [];

  for (const person of people) {
    if (person.name && person.name.toLowerCase().includes(q)) {
      out.push({ kind: 'person', label: person.name, value: person.id, count: photoIdsByPerson.get(person.id)?.length, faceId: person.coverFaceId });
    }
  }

  const cats = new Map<string, number>();
  const labels = new Map<string, number>();
  const years = new Map<number, number>();
  const folders = new Map<string, number>();
  for (const p of photos) {
    for (const c of p.categories) if (c.toLowerCase().includes(q)) cats.set(c, (cats.get(c) || 0) + 1);
    for (const l of p.labels) if (l.name.toLowerCase().includes(q)) labels.set(l.name, (labels.get(l.name) || 0) + 1);
    const y = new Date(p.takenAt).getFullYear();
    if (String(y).startsWith(q)) years.set(y, (years.get(y) || 0) + 1);
    const folderName = p.folder.split(/[\\/]/).pop() || '';
    if (folderName.toLowerCase().includes(q)) folders.set(folderName, (folders.get(folderName) || 0) + 1);
  }
  for (const [c, n] of cats) out.push({ kind: 'category', label: c, value: c, count: n });
  for (const [l, n] of [...labels].sort((a, b) => b[1] - a[1]).slice(0, 4)) out.push({ kind: 'label', label: l, value: l, count: n });
  for (const [y, n] of [...years].sort((a, b) => b[0] - a[0]).slice(0, 3)) out.push({ kind: 'year', label: String(y), value: String(y), count: n });
  for (const [fo, n] of [...folders].sort((a, b) => b[1] - a[1]).slice(0, 3)) out.push({ kind: 'folder', label: fo, value: fo, count: n });
  return out.slice(0, 10);
}
