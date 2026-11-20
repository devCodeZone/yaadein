/**
 * media.cjs — one place that answers "which file on disk is this picture?"
 *
 * The UI never sees raw disk paths in <img src>. Instead it asks for:
 *   yaadein://original/<photoId>   → the real photo/video on your hard disk
 *   yaadein://thumb/<photoId>      → small JPEG made by the background processor
 *   yaadein://preview/<photoId>    → large JPEG (only for HEIC, which Chrome can't show)
 *   yaadein://face/<faceId>        → small square crop of one face
 *
 * Both the desktop window (custom protocol in main.cjs) and the phone
 * (HTTP server in mobileServer.cjs) use this same function.
 */

const path = require('path');

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.3gp': 'video/3gpp',
};

/** Folder names inside the app's cache directory. */
const CACHE_FOLDERS = { thumb: 'thumbs', preview: 'previews', face: 'faces' };

/**
 * @param {import('./store.cjs').LibraryStore} store
 * @param {string} cacheDir   app cache folder (thumbnails etc.)
 * @param {'original'|'thumb'|'preview'|'face'} kind
 * @param {string} id         photo id (or face id for kind 'face')
 * @returns {{file:string, mime:string} | null}
 */
function resolveMedia(store, cacheDir, kind, id) {
  if (!/^[a-z]_[0-9a-f-]+$/i.test(id) && !/^[0-9a-f-]{36}$/i.test(id)) return null; // ids only, never paths
  if (kind === 'original') {
    const photo = store.data.photos[id];
    if (!photo) return null;
    return { file: photo.path, mime: MIME[photo.ext] || 'application/octet-stream' };
  }
  const folder = CACHE_FOLDERS[kind];
  if (!folder) return null;
  return { file: path.join(cacheDir, folder, `${id}.jpg`), mime: 'image/jpeg' };
}

module.exports = { resolveMedia, MIME, CACHE_FOLDERS };
