/**
 * SearchBar — the big search box at the top, with live suggestions.
 *
 * Typing "ri" suggests the person "Riya", the folder "Rishikesh trip", etc. Picking a suggestion turns it into a precise filter;
 * pressing Enter does a free-text search across names, folders and AI labels.
 * Everything ends up in the URL:  #/?q=beach&person=h_123
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useLibrary } from '../state/useLibrary';
import { filtersFromParams, paramsFromFilters, suggest, type Suggestion } from '../utils/search';
import { CATEGORIES } from '../ai/categories';
import { FaceAvatar } from './FaceAvatar';
import { Icon } from './Icon';

export function SearchBar() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const onPhotosPage = location.pathname === '/';
  const [text, setText] = useState(onPhotosPage ? params.get('q') || '' : '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // -1 = no suggestion highlighted
  const inputRef = useRef<HTMLInputElement>(null);

  const photos = useLibrary((s) => s.photos);
  const people = useLibrary((s) => s.people);
  const photoIdsByPerson = useLibrary((s) => s.photoIdsByPerson);

  // Keep the box in sync when the URL changes (Back button, chip clicks).
  useEffect(() => {
    setText(onPhotosPage ? params.get('q') || '' : '');
  }, [params, onPhotosPage]);

  // Ctrl/Cmd + K or "/" focuses search, like many web apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const suggestions = useMemo(() => (open ? suggest(text, photos, people, photoIdsByPerson) : []), [open, text, photos, people, photoIdsByPerson]);

  /** Go to the photos page with the given filters merged into the current ones. */
  function apply(change: (f: ReturnType<typeof filtersFromParams>) => void) {
    const f = filtersFromParams(onPhotosPage ? params : new URLSearchParams());
    change(f);
    navigate(`/?${paramsFromFilters(f)}`);
    setOpen(false);
    inputRef.current?.blur();
  }

  function pick(s: Suggestion) {
    apply((f) => {
      f.q = '';
      if (s.kind === 'person') f.people = [...new Set([...f.people, s.value])];
      else if (s.kind === 'category') f.cats = [...new Set([...f.cats, s.value])];
      else if (s.kind === 'year') f.year = Number(s.value);
      else f.q = s.value; // labels & folders are text searches
    });
  }

  return (
    <div className={`search ${open && suggestions.length ? 'search--open' : ''}`}>
      <Icon name="search" className="search__icon" />
      <input
        ref={inputRef}
        value={text}
        placeholder={api.mode === 'desktop' ? 'Search people, places, things, years…   ( / )' : 'Search people, things, years…'}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, suggestions.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, -1));
          else if (e.key === 'Enter') {
            // Highlighted suggestion → precise filter. Otherwise → free-text search.
            if (suggestions[active]) pick(suggestions[active]);
            else apply((f) => (f.q = text.trim()));
          } else if (e.key === 'Escape') inputRef.current?.blur();
        }}
      />
      {text && (
        <button className="icon-btn icon-btn--sm" onMouseDown={(e) => e.preventDefault()} onClick={() => apply((f) => (f.q = ''))} aria-label="Clear search">
          <Icon name="x" size={16} />
        </button>
      )}

      {open && suggestions.length > 0 && (
        <ul className="search__menu" role="listbox">
          {suggestions.map((s, i) => (
            <li key={`${s.kind}-${s.value}`}>
              <button className={i === active ? 'is-active' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
                {s.kind === 'person' ? (
                  <FaceAvatar faceId={s.faceId} name={s.label} size={28} />
                ) : (
                  <span className="search__kind">{s.kind === 'category' ? CATEGORIES[s.label] || '✨' : s.kind === 'year' ? '📅' : s.kind === 'folder' ? '📁' : '🔎'}</span>
                )}
                <span className="search__label">{s.label}</span>
                <span className="search__meta">
                  {s.kind} {s.count ? `· ${s.count.toLocaleString()}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
