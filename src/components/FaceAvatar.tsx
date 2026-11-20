/**
 * FaceAvatar — round picture of a person's face.
 * The face crop JPEG was saved by the AI processor (yaadein://face/<faceId>).
 */
import { useState } from 'react';
import { api } from '../api/client';

export function FaceAvatar({ faceId, name, size = 56, ring = false }: { faceId?: string; name?: string; size?: number; ring?: boolean }) {
  const [broken, setBroken] = useState(false);
  const initials = (name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <span className={`face-avatar ${ring ? 'face-avatar--ring' : ''}`} style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {faceId && !broken ? (
        <img src={api.mediaUrl('face', faceId)} alt={name || 'face'} loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <span>{initials}</span>
      )}
    </span>
  );
}
