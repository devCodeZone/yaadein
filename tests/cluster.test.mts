// Face-grouping test. Run with: npm test   (needs Node 22+, which can run TypeScript directly)
import { clusterFaces } from '../src/ai/clusterFaces.ts';
const rnd = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const base = (seed) => { const r = rnd(seed); return Array.from({ length: 128 }, () => (r() - 0.5) * 0.25); };
const jitter = (v, seed) => { const r = rnd(seed); return v.map((x) => x + (r() - 0.5) * 0.02); };
const A = base(11), B = base(99);
const faces = [
  { id: 'a1', photoId: 'p1', personId: null, box: { w: 0.1 }, score: 0.9, descriptor: jitter(A, 1) },
  { id: 'a2', photoId: 'p2', personId: null, box: { w: 0.1 }, score: 0.9, descriptor: jitter(A, 2) },
  { id: 'a3', photoId: 'p2', personId: null, box: { w: 0.1 }, score: 0.9, descriptor: jitter(A, 3) }, // same photo as a2!
  { id: 'b1', photoId: 'p3', personId: null, box: { w: 0.1 }, score: 0.9, descriptor: jitter(B, 4) },
  { id: 'b2', photoId: 'p4', personId: null, box: { w: 0.1 }, score: 0.9, descriptor: jitter(B, 5) },
];
const r = clusterFaces(faces, [], 0.5);
console.log('people', r.newPeople.length, r.assignments);
if (r.newPeople.length !== 2) throw new Error('expected 2 people');
if (r.assignments.a2 === r.assignments.a3) throw new Error('same person twice in one photo');
console.log('OK');
