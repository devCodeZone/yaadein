/**
 * ThingsPage — "Explore": photos grouped by what's in them (dogs, food, beaches…)
 * Clicking a card opens the Photos page filtered by that category.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useLibrary } from '../state/useLibrary';
import { CATEGORIES } from '../ai/categories';
import { EmptyState } from '../components/EmptyState';
import type { Photo } from '../api/types';

export function ThingsPage() {
  const photos = useLibrary((s) => s.photos);
  const ai = useLibrary((s) => s.ai);

  const { cats, labels, videos } = useMemo(() => {
    const cats = new Map<string, { count: number; cover: Photo }>();
    const labels = new Map<string, number>();
    let videos: Photo | null = null;
    let videoCount = 0;
    for (const p of photos) {
      if (p.type === 'video') {
        videoCount++;
        if (!videos && p.hasThumb) videos = p;
      }
      for (const c of p.categories) {
        const entry = cats.get(c);
        if (!entry) cats.set(c, { count: 1, cover: p });
        else {
          entry.count++;
          // prefer a cover that has a thumbnail
          if (!entry.cover.hasThumb && p.hasThumb) entry.cover = p;
        }
      }
      for (const l of p.labels) labels.set(l.name, (labels.get(l.name) || 0) + 1);
    }
    return {
      cats: Object.keys(CATEGORIES).filter((c) => cats.has(c)).map((c) => ({ name: c, ...cats.get(c)! })),
      labels: [...labels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60),
      videos: videos ? { cover: videos, count: videoCount } : null,
    };
  }, [photos]);

  if (!cats.length && !videos) {
    return (
      <EmptyState
        title="Things will appear here"
        text={
          ai.running
            ? `Recognising objects and scenes… ${ai.done.toLocaleString()} / ${ai.total.toLocaleString()}`
            : 'Yaadein recognises 1,000 kinds of objects and scenes — dogs, food, beaches, cars, documents — and groups them for you.'
        }
      />
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">Things</h1>
      {!ai.labelsAvailable && (
        <p className="notice">
          ⚠️ The object-recognition model couldn't be downloaded (are you offline?). Faces still work. Run <code>npm run download-models</code> once with internet to keep it offline forever.
        </p>
      )}
      <div className="things-grid">
        {videos && (
          <Link to="/?type=video" className="thing-card">
            <img src={api.mediaUrl('thumb', videos.cover.id)} alt="" loading="lazy" />
            <span className="thing-card__label">
              🎬 Videos <small>{videos.count}</small>
            </span>
          </Link>
        )}
        {cats.map((c) => (
          <Link key={c.name} to={`/?cat=${encodeURIComponent(c.name)}`} className="thing-card">
            {c.cover.hasThumb ? <img src={api.mediaUrl('thumb', c.cover.id)} alt="" loading="lazy" /> : <span className="tile__placeholder" />}
            <span className="thing-card__label">
              {CATEGORIES[c.name]} {c.name} <small>{c.count.toLocaleString()}</small>
            </span>
          </Link>
        ))}
      </div>

      {labels.length > 0 && (
        <>
          <h2 className="section-title">Everything Yaadein spotted</h2>
          <div className="chips chips--cloud">
            {labels.map(([name, n]) => (
              <Link key={name} to={`/?q=${encodeURIComponent(name)}`} className="chip chip--ghost">
                {name} <small>{n}</small>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
