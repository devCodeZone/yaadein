/**
 * Lightbox — full-screen viewer with an info panel.
 *
 * Keyboard: ← / → previous/next, Esc close, I info panel, F favourite.
 * Click the photo to zoom 100% / fit.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Photo } from '../api/types';
import { api } from '../api/client';
import { useLibrary, personName } from '../state/useLibrary';
import { formatBytes, formatDateTime } from '../utils/dates';
import { CATEGORIES } from '../ai/categories';
import { FaceAvatar } from './FaceAvatar';
import { Icon } from './Icon';

interface Props {
  list: Photo[];
  startId: string;
  onClose: () => void;
}

export function Lightbox({ list, startId, onClose }: Props) {
  const [index, setIndex] = useState(() => Math.max(0, list.findIndex((p) => p.id === startId)));
  const [showInfo, setShowInfo] = useState(() => window.innerWidth > 1100);
  const [zoom, setZoom] = useState(false);
  const photosById = useLibrary((s) => s.photosById);
  // Re-read from the store so ♥ changes show immediately.
  const photo = photosById.get(list[index]?.id) || list[index];

  const go = useCallback(
    (delta: number) => {
      setZoom(false);
      setIndex((i) => Math.min(list.length - 1, Math.max(0, i + delta)));
    },
    [list.length]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key.toLowerCase() === 'i') setShowInfo((v) => !v);
      else if (e.key.toLowerCase() === 'f' && photo) useLibrary.getState().setFavorite([photo.id], !photo.favorite);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose, photo]);

  // Swipe left/right on touch screens (phone).
  const [touchX, setTouchX] = useState<number | null>(null);

  if (!photo) return null;
  const src = photo.hasPreview ? api.mediaUrl('preview', photo.id) : api.mediaUrl('original', photo.id);

  return (
    <div className="lightbox" role="dialog" aria-modal>
      <div
        className="lightbox__stage"
        onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX === null) return;
          const dx = e.changedTouches[0].clientX - touchX;
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
          setTouchX(null);
        }}
      >
        <div className="lightbox__bar">
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            <Icon name="x" />
          </button>
          <span className="lightbox__count">
            {index + 1} / {list.length}
          </span>
          <span style={{ flex: 1 }} />
          <button
            className={`icon-btn ${photo.favorite ? 'is-fav' : ''}`}
            onClick={() => useLibrary.getState().setFavorite([photo.id], !photo.favorite)}
            title="Favourite (F)"
          >
            <Icon name="heart" filled={photo.favorite} />
          </button>
          {api.desktop && (
            <button className="icon-btn" onClick={() => api.desktop!.reveal(photo.id)} title="Show in folder">
              <Icon name="folder" />
            </button>
          )}
          <button className={`icon-btn ${showInfo ? 'is-active' : ''}`} onClick={() => setShowInfo((v) => !v)} title="Info (I)">
            <Icon name="info" />
          </button>
        </div>

        {index > 0 && (
          <button className="lightbox__nav lightbox__nav--left" onClick={() => go(-1)} aria-label="Previous">
            <Icon name="left" size={28} />
          </button>
        )}
        {index < list.length - 1 && (
          <button className="lightbox__nav lightbox__nav--right" onClick={() => go(1)} aria-label="Next">
            <Icon name="right" size={28} />
          </button>
        )}

        <div className={`lightbox__media ${zoom ? 'is-zoomed' : ''}`} onClick={() => photo.type === 'image' && setZoom((z) => !z)}>
          {photo.type === 'video' ? (
            <video key={photo.id} src={src} controls autoPlay />
          ) : (
            // key= forces a fresh <img> so the old photo doesn't flash
            <img key={photo.id} src={src} alt={photo.name} />
          )}
        </div>
      </div>

      {showInfo && <InfoPanel photo={photo} onNavigate={onClose} />}
    </div>
  );
}

function InfoPanel({ photo, onNavigate }: { photo: Photo; onNavigate: () => void }) {
  const facesById = useLibrary((s) => s.facesById);
  const peopleById = useLibrary((s) => s.peopleById);
  const sources = useLibrary((s) => s.sources);

  const people = photo.faceIds
    .map((id) => facesById.get(id))
    .filter((f) => f?.personId)
    .map((f) => ({ face: f!, person: peopleById.get(f!.personId!) }))
    .filter((x) => x.person && !x.person.hidden);
  const unknownFaces = photo.faceIds.length - people.length;
  const source = sources.find((s) => s.id === photo.sourceId);

  return (
    <aside className="info">
      <h3 className="info__title">Details</h3>

      <div className="info__row">
        <Icon name="calendar" />
        <div>
          <strong>{formatDateTime(photo.takenAt)}</strong>
          <small>Date from {photo.dateSource === 'exif' ? 'camera' : photo.dateSource === 'takeout' ? 'Google Takeout' : photo.dateSource === 'filename' ? 'file name' : 'file'}</small>
        </div>
      </div>

      <div className="info__row">
        <Icon name="photos" />
        <div>
          <strong className="break">{photo.name}</strong>
          <small>
            {photo.width && photo.height ? `${photo.width} × ${photo.height} · ` : ''}
            {formatBytes(photo.size)}
          </small>
        </div>
      </div>

      {photo.camera && (
        <div className="info__row">
          <Icon name="camera" />
          <div>
            <strong>{photo.camera}</strong>
          </div>
        </div>
      )}

      <div className="info__row">
        <Icon name="folder" />
        <div>
          <strong className="break">{photo.folder}</strong>
          {source && <small>Source: {source.label}</small>}
        </div>
      </div>

      {photo.gps && (
        <div className="info__row">
          <Icon name="pin" />
          <div>
            <a href={`https://www.google.com/maps?q=${photo.gps.lat},${photo.gps.lng}`} target="_blank" rel="noreferrer">
              {photo.gps.lat}, {photo.gps.lng} ↗
            </a>
            <small>Opens in Google Maps</small>
          </div>
        </div>
      )}

      {(people.length > 0 || unknownFaces > 0) && (
        <>
          <h4 className="info__sub">People</h4>
          <div className="info__people">
            {people.map(({ face, person }) => (
              <Link key={face.id} to={`/people/${person!.id}`} onClick={onNavigate} className="info__person">
                <FaceAvatar faceId={face.id} name={person!.name} size={44} />
                <span>{personName(person)}</span>
              </Link>
            ))}
            {unknownFaces > 0 && <span className="muted">+{unknownFaces} not grouped yet</span>}
          </div>
        </>
      )}

      {photo.categories.length > 0 && (
        <>
          <h4 className="info__sub">Things</h4>
          <div className="chips">
            {photo.categories.map((c) => (
              <Link key={c} className="chip" to={`/?cat=${encodeURIComponent(c)}`} onClick={onNavigate}>
                {CATEGORIES[c] || '✨'} {c}
              </Link>
            ))}
            {photo.labels.map((l) => (
              <Link key={l.name} className="chip chip--ghost" to={`/?q=${encodeURIComponent(l.name)}`} onClick={onNavigate}>
                {l.name} <small>{Math.round(l.score * 100)}%</small>
              </Link>
            ))}
          </div>
        </>
      )}
      {!photo.aiDone && photo.type === 'image' && <p className="muted small">✨ Still analysing faces & objects…</p>}
    </aside>
  );
}
