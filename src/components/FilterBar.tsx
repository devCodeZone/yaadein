/**
 * FilterBar — the row of filter chips under the search box.
 * Reads & writes the URL so filters survive refresh and Back/Forward.
 */
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLibrary, personName } from '../state/useLibrary';
import { CATEGORIES } from '../ai/categories';
import { EMPTY_FILTERS, filtersFromParams, hasActiveFilters, paramsFromFilters, type Filters } from '../utils/search';
import { FaceAvatar } from './FaceAvatar';
import { Icon } from './Icon';

export function FilterBar({ resultCount }: { resultCount: number }) {
  const [params, setParams] = useSearchParams();
  const f = filtersFromParams(params);
  const photos = useLibrary((s) => s.photos);
  const people = useLibrary((s) => s.people);
  const peopleById = useLibrary((s) => s.peopleById);
  const photoIdsByPerson = useLibrary((s) => s.photoIdsByPerson);
  const sources = useLibrary((s) => s.sources);

  const update = (change: (f: Filters) => void) => {
    const next = filtersFromParams(params);
    change(next);
    setParams(paramsFromFilters(next));
  };

  // Options are computed from the library itself, with counts.
  const years = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of photos) {
      const y = new Date(p.takenAt).getFullYear();
      m.set(y, (m.get(y) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [photos]);

  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of photos) for (const c of p.categories) m.set(c, (m.get(c) || 0) + 1);
    return Object.keys(CATEGORIES).filter((c) => m.has(c)).map((c) => [c, m.get(c)!] as const);
  }, [photos]);

  const topPeople = useMemo(
    () =>
      people
        .filter((p) => !p.hidden)
        .map((p) => ({ p, n: photoIdsByPerson.get(p.id)?.length || 0 }))
        .filter((x) => x.n > 1)
        .sort((a, b) => Number(Boolean(b.p.name)) - Number(Boolean(a.p.name)) || b.n - a.n)
        .slice(0, 12),
    [people, photoIdsByPerson]
  );

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="filters">
      <div className="filters__row">
        <button className={`chip ${!f.type ? 'is-on' : ''}`} onClick={() => update((n) => (n.type = null))}>
          All
        </button>
        <button className={`chip ${f.type === 'image' ? 'is-on' : ''}`} onClick={() => update((n) => (n.type = n.type === 'image' ? null : 'image'))}>
          Photos
        </button>
        <button className={`chip ${f.type === 'video' ? 'is-on' : ''}`} onClick={() => update((n) => (n.type = n.type === 'video' ? null : 'video'))}>
          Videos
        </button>
        <button className={`chip ${f.fav ? 'is-on' : ''}`} onClick={() => update((n) => (n.fav = !n.fav))}>
          <Icon name="heart" size={14} filled={f.fav} /> Favourites
        </button>
        <button className={`chip ${f.place ? 'is-on' : ''}`} onClick={() => update((n) => (n.place = !n.place))}>
          <Icon name="pin" size={14} /> Has location
        </button>

        <select className="chip chip--select" value={f.year ?? ''} onChange={(e) => update((n) => (n.year = e.target.value ? Number(e.target.value) : null))}>
          <option value="">Any year</option>
          {years.map(([y, n]) => (
            <option key={y} value={y}>
              {y} ({n.toLocaleString()})
            </option>
          ))}
        </select>

        {sources.length > 1 && (
          <select className="chip chip--select" value={f.source ?? ''} onChange={(e) => update((n) => (n.source = e.target.value || null))}>
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        )}

        {hasActiveFilters(f) && (
          <button className="chip chip--clear" onClick={() => setParams(paramsFromFilters(EMPTY_FILTERS))}>
            <Icon name="x" size={14} /> Clear · {resultCount.toLocaleString()} results
          </button>
        )}
      </div>

      {(topPeople.length > 0 || f.people.length > 0) && (
        <div className="filters__row filters__people">
          {/* Selected people that aren't in the top list still show up */}
          {[...new Set([...f.people, ...topPeople.map((x) => x.p.id)])].map((id) => {
            const person = peopleById.get(id);
            if (!person) return null;
            const on = f.people.includes(id);
            return (
              <button key={id} className={`person-chip ${on ? 'is-on' : ''}`} onClick={() => update((n) => (n.people = toggle(n.people, id)))} title={personName(person)}>
                <FaceAvatar faceId={person.coverFaceId} name={person.name} size={34} ring={on} />
                <span>{person.name || 'Unnamed'}</span>
              </button>
            );
          })}
        </div>
      )}

      {cats.length > 0 && (
        <div className="filters__row">
          {cats.map(([c, n]) => (
            <button key={c} className={`chip ${f.cats.includes(c) ? 'is-on' : ''}`} onClick={() => update((x) => (x.cats = toggle(x.cats, c)))}>
              {CATEGORIES[c]} {c} <small>{n}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
