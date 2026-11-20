/**
 * useLightbox — tiny hook so every page can open the full-screen viewer.
 *
 *   const { open, lightbox } = useLightbox();
 *   <PhotoGrid onOpen={open} … />
 *   {lightbox}
 */
import { useCallback, useState } from 'react';
import type { Photo } from '../api/types';
import { Lightbox } from './Lightbox';

export function useLightbox() {
  const [state, setState] = useState<{ list: Photo[]; id: string } | null>(null);
  const open = useCallback((photo: Photo, list: Photo[]) => setState({ list, id: photo.id }), []);
  const lightbox = state ? <Lightbox list={state.list} startId={state.id} onClose={() => setState(null)} /> : null;
  return { open, lightbox };
}
