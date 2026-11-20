/**
 * clusterFaces.ts — groups faces into people (like Google Photos' "People").
 *
 * Each face has a "descriptor": 128 numbers. Faces of the same person have
 * descriptors that are close together (small Euclidean distance, ~0.3–0.5);
 * different people are far apart (~0.7+).
 *
 * Algorithm (simple, readable "greedy centroid clustering"):
 *   1. For every existing person compute the AVERAGE descriptor of their faces
 *      (the "centroid" — the typical look of that person).
 *   2. Each new, unassigned face → nearest centroid. If it's closer than the
 *      threshold, it belongs to that person.
 *   3. Faces that matched nobody are clustered among themselves. Any group
 *      with 2+ faces becomes a NEW person (unnamed until you name them).
 *      Lonely single faces wait — a later photo may give them a partner.
 *
 * Rule: one person can appear only ONCE in a photo, so two faces from the same
 * photo are never put into the same person.
 *
 * You stay in control: rename, merge two people, or remove a wrong face.
 * Removed faces get `manual: true` and are never auto-assigned again.
 */
import type { Face, Person } from '../api/types';

type Vec = Float32Array;

/**
 * Euclidean distance with an early exit: we only care whether it's below
 * `limit`, so we stop as soon as the running sum is too big. This makes
 * comparing thousands of faces ~4× faster.
 */
function distanceBelow(a: Vec, b: Vec, limit: number): number {
  const limitSq = limit * limit;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
    if (sum > limitSq) return Infinity;
  }
  return Math.sqrt(sum);
}

/** Running average: we keep the sum and count so adding a face is cheap. */
class Centroid {
  sum: Float64Array;
  count = 0;
  mean: Vec;
  constructor(size = 128) {
    this.sum = new Float64Array(size);
    this.mean = new Float32Array(size);
  }
  add(v: Vec) {
    this.count++;
    for (let i = 0; i < v.length; i++) {
      this.sum[i] += v[i];
      this.mean[i] = this.sum[i] / this.count;
    }
  }
}

export interface ClusterResult {
  /** People that should be created (new) */
  newPeople: Person[];
  /** faceId → personId for every face whose assignment changed */
  assignments: Record<string, string>;
}

const newPersonId = () => `h_${crypto.randomUUID()}`;

/**
 * @param faces      all faces (only those with descriptors are considered)
 * @param people     existing people
 * @param threshold  max distance to count as "same person" (settings, default 0.5)
 * @param groupLoners also group still-unassigned faces into new people
 *                    (a bit slower — the processor does this every few hundred photos)
 */
export function clusterFaces(faces: Face[], people: Person[], threshold = 0.5, groupLoners = true): ClusterResult {
  const vec = new Map<string, Vec>();
  for (const f of faces) if (f.descriptor?.length) vec.set(f.id, Float32Array.from(f.descriptor));

  // 1) centroids of existing people
  const centroids = new Map<string, Centroid>();
  for (const p of people) centroids.set(p.id, new Centroid());
  for (const f of faces) {
    const v = vec.get(f.id);
    if (f.personId && v && centroids.has(f.personId)) centroids.get(f.personId)!.add(v);
  }
  const known = [...centroids.entries()].filter(([, c]) => c.count > 0);

  // personId → photos they already appear in (enforces "once per photo")
  const photosOf = new Map<string, Set<string>>();
  const markPhoto = (personId: string, photoId: string) => {
    if (!photosOf.has(personId)) photosOf.set(personId, new Set());
    photosOf.get(personId)!.add(photoId);
  };
  for (const f of faces) if (f.personId) markPhoto(f.personId, f.photoId);

  const assignments: Record<string, string> = {};
  const loners: Face[] = [];

  // 2) match unassigned faces to existing people
  for (const f of faces) {
    const v = vec.get(f.id);
    if (f.personId || f.manual || !v) continue;
    let best: string | null = null;
    let bestDist = threshold;
    for (const [pid, c] of known) {
      if (photosOf.get(pid)?.has(f.photoId)) continue; // already in this photo
      const d = distanceBelow(v, c.mean, bestDist);
      if (d < bestDist) {
        bestDist = d;
        best = pid;
      }
    }
    if (best) {
      assignments[f.id] = best;
      centroids.get(best)!.add(v);
      markPhoto(best, f.photoId);
    } else {
      loners.push(f);
    }
  }

  // 3) group the loners among themselves
  const newPeople: Person[] = [];
  if (groupLoners && loners.length > 1) {
    const groups: Array<{ c: Centroid; faces: Face[]; photos: Set<string> }> = [];
    for (const f of loners) {
      const v = vec.get(f.id)!;
      let best: (typeof groups)[number] | null = null;
      let bestDist = threshold;
      for (const g of groups) {
        if (g.photos.has(f.photoId)) continue;
        const d = distanceBelow(v, g.c.mean, bestDist);
        if (d < bestDist) {
          bestDist = d;
          best = g;
        }
      }
      if (!best) {
        best = { c: new Centroid(v.length), faces: [], photos: new Set() };
        groups.push(best);
      }
      best.c.add(v);
      best.faces.push(f);
      best.photos.add(f.photoId);
    }
    for (const g of groups) {
      if (g.faces.length < 2) continue; // wait for more photos
      // Cover photo = the clearest (highest score) and biggest face.
      const cover = [...g.faces].sort((a, b) => b.score * b.box.w - a.score * a.box.w)[0];
      const person: Person = { id: newPersonId(), name: '', coverFaceId: cover.id, createdAt: Date.now() };
      newPeople.push(person);
      for (const f of g.faces) assignments[f.id] = person.id;
    }
  }

  return { newPeople, assignments };
}
