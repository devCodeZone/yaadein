/**
 * Memories — "On this day" cards at the top of the Photos page.
 * Shows photos from the same week in earlier years, like Google Photos.
 */
import { useMemo } from 'react';
import type { Photo } from '../api/types';
import { api } from '../api/client';
import { memoriesFor } from '../utils/dates';

export function Memories({ photos, onOpen }: { photos: Photo[]; onOpen: (p: Photo, list: Photo[]) => void }) {
  const memories = useMemo(() => memoriesFor(photos), [photos]);
  if (!memories.length) return null;

  return (
    <section className="memories">
      <h2 className="section-title">
        On this day <span className="hand">yaadein ✦</span>
      </h2>
      <div className="memories__row">
        {memories.map((m) => {
          const cover = m.photos.find((p) => p.hasThumb) || m.photos[0];
          return (
            <button key={m.year} className="memory" onClick={() => onOpen(cover, m.photos)}>
              <img src={api.mediaUrl(cover.hasThumb ? 'thumb' : 'original', cover.id)} alt="" loading="lazy" />
              <span className="memory__shade" />
              <span className="memory__text">
                <strong>{m.yearsAgo === 1 ? '1 year ago' : `${m.yearsAgo} years ago`}</strong>
                <small>
                  {m.year} · {m.photos.length} photo{m.photos.length > 1 ? 's' : ''}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
