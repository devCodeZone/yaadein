/**
 * PhotoGrid — the Google-Photos-style "justified" timeline.
 *
 * LAYOUT TRICK (pure CSS, no measuring):
 *   Each tile gets  flex-grow = aspectRatio  and  flex-basis = aspectRatio × rowHeight.
 *   Flexbox then fills every row edge-to-edge while keeping each photo's shape.
 *   A wide panorama grows 3× more than a portrait. An invisible "filler" at
 *   the end stops the last row from stretching.
 *
 * PERFORMANCE:
 *   Rendering 20,000 <img> at once would freeze the app, so we render the
 *   first 300 and add 300 more whenever a sentinel <div> at the bottom comes
 *   into view (IntersectionObserver = "infinite scroll").
 *   Month sections also use CSS `content-visibility: auto`, so the browser
 *   skips painting sections that are off-screen.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Photo } from '../api/types';
import { api } from '../api/client';
import { groupByMonth } from '../utils/dates';
import { Icon } from './Icon';

const PAGE = 300;

interface Props {
  photos: Photo[];
  onOpen: (photo: Photo, list: Photo[]) => void;
  grouped?: boolean; // show "March 2024" headers
  rowHeight?: number;
  selected?: Set<string>;
  onToggleSelect?: (id: string, shiftKey: boolean) => void;
}

export function PhotoGrid({ photos, onOpen, grouped = true, rowHeight, selected, onToggleSelect }: Props) {
  // Smaller rows on phones so 2–3 photos fit side by side.
  const rh = rowHeight ?? (window.innerWidth < 760 ? 120 : 200);
  const [limit, setLimit] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);

  // New photo list (e.g. a search) → start from the top again.
  useEffect(() => setLimit(PAGE), [photos]);

  // Infinite scroll
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setLimit((l) => l + PAGE);
    }, { rootMargin: '1200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [photos]);

  const visible = useMemo(() => photos.slice(0, limit), [photos, limit]);
  const groups = useMemo(() => (grouped ? groupByMonth(visible) : [{ key: 'all', title: '', photos: visible }]), [visible, grouped]);
  const selecting = Boolean(selected && selected.size);

  return (
    <div className={`grid ${selecting ? 'grid--selecting' : ''}`}>
      {groups.map((g) => (
        <section key={g.key} className="grid__section">
          {g.title && (
            <h3 className="grid__title">
              {g.title} <span>{g.photos.length.toLocaleString()}</span>
            </h3>
          )}
          <div className="grid__rows">
            {g.photos.map((p) => {
              const ratio = p.width && p.height ? Math.min(Math.max(p.width / p.height, 0.5), 2.6) : 1.33;
              const isSel = selected?.has(p.id);
              return (
                <button
                  key={p.id}
                  className={`tile ${isSel ? 'tile--selected' : ''}`}
                  style={{ flexGrow: ratio, flexBasis: ratio * rh, height: rh }}
                  onClick={(e) => (selecting && onToggleSelect ? onToggleSelect(p.id, e.shiftKey) : onOpen(p, photos))}
                  title={p.name}
                >
                  <Thumb photo={p} />
                  {p.type === 'video' && (
                    <span className="tile__badge">
                      <Icon name="play" size={12} filled /> Video
                    </span>
                  )}
                  {p.favorite && (
                    <span className="tile__fav">
                      <Icon name="heart" size={16} filled />
                    </span>
                  )}
                  {onToggleSelect && (
                    <span
                      className="tile__check"
                      role="checkbox"
                      aria-checked={isSel}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelect(p.id, e.shiftKey);
                      }}
                    >
                      <Icon name="check" size={14} />
                    </span>
                  )}
                </button>
              );
            })}
            <span className="grid__filler" />
          </div>
        </section>
      ))}
      <div ref={sentinel} style={{ height: 1 }} />
    </div>
  );
}

/** Thumbnail if it exists; the original (lazy) while it's still being made. */
export function Thumb({ photo }: { photo: Photo }) {
  const [failed, setFailed] = useState(false);
  if (photo.hasThumb && !failed) {
    return <img src={api.mediaUrl('thumb', photo.id)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  }
  if (photo.type === 'image' && !['.heic', '.heif', '.tif', '.tiff'].includes(photo.ext) && api.mode === 'desktop') {
    return <img src={api.mediaUrl('original', photo.id)} alt="" loading="lazy" decoding="async" className="tile__raw" />;
  }
  return <span className="tile__placeholder" />;
}
