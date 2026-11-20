/**
 * dates.ts — grouping photos into a timeline (like Google Photos).
 */
import type { Photo } from '../api/types';

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface MonthGroup {
  key: string; // "2024-03"
  title: string; // "March 2024"
  photos: Photo[];
}

/** Photos must already be sorted newest → oldest. */
export function groupByMonth(photos: Photo[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  let current: MonthGroup | null = null;
  for (const p of photos) {
    const d = new Date(p.takenAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!current || current.key !== key) {
      current = { key, title: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, photos: [] };
      groups.push(current);
    }
    current.photos.push(p);
  }
  return groups;
}

/** "Sat, 14 Mar 2021 · 10:15 am" */
export function formatDateTime(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * "Memories": photos taken on today's date (±3 days) in previous years,
 * grouped by year — like Google Photos' "1 year ago" cards.
 */
export function memoriesFor(photos: Photo[], today = new Date()) {
  const byYear = new Map<number, Photo[]>();
  const dayOfYear = (d: Date) => Math.floor((Date.UTC(2000, d.getMonth(), d.getDate()) - Date.UTC(2000, 0, 0)) / 86400000);
  const todayDoy = dayOfYear(today);
  for (const p of photos) {
    if (p.type !== 'image') continue;
    const d = new Date(p.takenAt);
    if (d.getFullYear() >= today.getFullYear()) continue;
    if (Math.abs(dayOfYear(d) - todayDoy) > 3) continue;
    const list = byYear.get(d.getFullYear()) || [];
    list.push(p);
    byYear.set(d.getFullYear(), list);
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => ({ year, yearsAgo: today.getFullYear() - year, photos: list }));
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
