/**
 * PhotosPage — the home screen: memories, search results / filters, timeline.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useLibrary } from '../state/useLibrary';
import { buildSearchIndex, filterPhotos, filtersFromParams, hasActiveFilters } from '../utils/search';
import { PhotoGrid } from '../components/PhotoGrid';
import { FilterBar } from '../components/FilterBar';
import { Memories } from '../components/Memories';
import { EmptyState } from '../components/EmptyState';
import { useLightbox } from '../components/useLightbox';
import { Icon } from '../components/Icon';
import { plural } from '../utils/dates';

export function PhotosPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const photos = useLibrary((s) => s.photos);
  const facesById = useLibrary((s) => s.facesById);
  const photosById = useLibrary((s) => s.photosById);
  const peopleById = useLibrary((s) => s.peopleById);
  const setFavorite = useLibrary((s) => s.setFavorite);
  const { open, lightbox } = useLightbox();

  // Multi-select (click the ✓ on a tile; shift-click selects a range)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClicked, setLastClicked] = useState<string | null>(null);

  const filters = filtersFromParams(params);
  // The search index only needs rebuilding when the data changes, not on every keystroke.
  const index = useMemo(() => buildSearchIndex(photos, facesById, peopleById), [photos, facesById, peopleById]);
  const results = useMemo(() => filterPhotos(photos, filters, index, facesById), [photos, params, index, facesById]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtering = hasActiveFilters(filters);

  function toggleSelect(id: string, shift: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && lastClicked) {
        const a = results.findIndex((p) => p.id === lastClicked);
        const b = results.findIndex((p) => p.id === id);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(results[i].id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastClicked(id);
  }

  if (!photos.length) {
    return (
      <EmptyState
        title="Let's gather your yaadein"
        text={
          api.desktop
            ? 'Connect your hard disk, pick any folder of photos, or bring them in from Google Drive and Google Photos. Everything stays on your computer.'
            : 'No photos yet. Add folders in the Yaadein desktop app on your computer.'
        }
        action={
          api.desktop && (
            <button className="btn btn--primary btn--lg" onClick={() => navigate('/sources')}>
              <Icon name="plus" /> Add photos
            </button>
          )
        }
      />
    );
  }

  const selectedIds = [...selected];
  const allFav = selectedIds.every((id) => photosById.get(id)?.favorite);

  return (
    <div className="page">
      {!filtering && <Memories photos={photos} onOpen={open} />}
      <FilterBar resultCount={results.length} />

      {filtering && (
        <h2 className="section-title">
          {results.length ? plural(results.length, 'result') : 'Nothing found'}
          {filters.q && <span className="muted"> for “{filters.q}”</span>}
        </h2>
      )}
      {filtering && !results.length && (
        <p className="muted">
          Try another word — search understands people's names, folders, file names, years, months and things like “beach”, “dog”, “food”, “car”, “wedding”.
        </p>
      )}

      <PhotoGrid photos={results} onOpen={open} selected={selected} onToggleSelect={api.desktop ? toggleSelect : undefined} />

      {selected.size > 0 && (
        <div className="selection-bar">
          <button className="icon-btn" onClick={() => setSelected(new Set())} title="Clear selection">
            <Icon name="x" />
          </button>
          <strong>{selected.size} selected</strong>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => setSelected(new Set(results.map((p) => p.id)))}>
            Select all {results.length.toLocaleString()}
          </button>
          <button className="btn" onClick={() => setFavorite(selectedIds, !allFav)}>
            <Icon name="heart" filled={!allFav} size={16} /> {allFav ? 'Unfavourite' : 'Favourite'}
          </button>
          <button className="btn btn--primary" onClick={() => navigate('/organize', { state: { photoIds: selectedIds } })}>
            <Icon name="wand" size={16} /> Organize these
          </button>
        </div>
      )}
      {lightbox}
    </div>
  );
}

export function FavoritesPage() {
  const photos = useLibrary((s) => s.photos);
  const favs = useMemo(() => photos.filter((p) => p.favorite), [photos]);
  const { open, lightbox } = useLightbox();
  return (
    <div className="page">
      <h1 className="page-title">Favourites</h1>
      {favs.length ? (
        <PhotoGrid photos={favs} onOpen={open} />
      ) : (
        <EmptyState title="No favourites yet" text="Open any photo and tap the ♥ (or press F) to keep it here." />
      )}
      {lightbox}
    </div>
  );
}
