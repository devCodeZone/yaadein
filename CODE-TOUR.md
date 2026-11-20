# Code tour — Yaadein for a frontend developer

If you know React, you already know about 70% of this app. The new part is **Electron**:
a small Node.js “backend” that lives on the same computer and is allowed to touch your disk.

## The big picture

```
┌──────────────────────────── Desktop app (Electron) ─────────────────────────────┐
│                                                                                 │
│  RENDERER  (= a normal React website, src/)          MAIN  (= Node.js, electron/)│
│  ┌───────────────────────────────┐   IPC            ┌─────────────────────────┐ │
│  │ pages/ components/            │  invoke() ─────▶ │ main.cjs  (the "router")│ │
│  │ state/useLibrary.ts (Zustand) │ ◀───── events    │  ├ scanner.cjs   disks  │ │
│  │ api/client.ts ──┐             │                  │  ├ organizer.cjs folders│ │
│  │ ai/processor.ts │ TensorFlow  │                  │  ├ google.cjs    Google │ │
│  │   faces+objects │ on your GPU │ yaadein://thumb/ │  ├ store.cjs   library  │ │
│  └─────────────────┼─────────────┘ ◀──── images ─── │  └ mobileServer.cjs ──┐ │ │
│                    │                                └───────────────────────┼─┘ │
└────────────────────┼────────────────────────────────────────────────────────┼───┘
                     │ same React code                          HTTP over Wi-Fi│
              ┌──────┴──────────────────────┐                                  │
              │ PHONE (browser or Capacitor)│ ◀────────────────────────────────┘
              │ api/remoteApi.ts → fetch()  │
              └─────────────────────────────┘
```

**One React codebase, two backends.** `src/api/client.ts` exports one `api` object.
- On desktop it uses `electronApi.ts`, which calls the main process through `window.yaadein.invoke(...)`.
- On the phone it uses `remoteApi.ts`, which calls the desktop's HTTP server through `fetch(...)`.
- Desktop-only powers are under `api.desktop`, which is `undefined` on the phone, so a page just does `if (api.desktop)`.

## Reading order (about 1–2 hours)

| # | File | What you'll learn |
|---|------|-------------------|
| 1 | `src/api/types.ts` | Every data shape: Photo, Face, Person, Source… |
| 2 | `src/api/client.ts` | The single API interface (desktop and phone) |
| 3 | `src/state/useLibrary.ts` | Global state with Zustand, plus lookup maps (indexes) |
| 4 | `src/App.tsx` | Layout, routes, start-up |
| 5 | `src/pages/PhotosPage.tsx` → `components/PhotoGrid.tsx` | The justified timeline, infinite scroll, selection |
| 6 | `src/utils/search.ts` + `components/SearchBar.tsx`, `FilterBar.tsx` | Search, synonyms, filters stored in the URL |
| 7 | `src/components/Lightbox.tsx` | Full-screen viewer and info panel |
| 8 | `src/ai/processor.ts` | Background pipeline: thumbnail → faces → objects |
| 9 | `src/ai/models.ts`, `clusterFaces.ts`, `categories.ts` | How faces become *people* and labels become *categories* |
| 10 | `electron/preload.cjs` → `electron/main.cjs` | The bridge, IPC handlers (“API endpoints”), the `yaadein://` protocol |
| 11 | `electron/scanner.cjs` | Walking a disk, EXIF, Takeout `.json`, fingerprints |
| 12 | `electron/organizer.cjs` | Plan → apply → undo, duplicates |
| 13 | `electron/google.cjs` | OAuth sign-in with PKCE, Drive download, Photos Picker |
| 14 | `electron/mobileServer.cjs` | The Wi-Fi server for the phone |
| 15 | `tests/` | How the backend is tested without Electron |

## Life of a photo

1. **Scan** (`scanner.cjs`): a file on your disk becomes a `Photo` record (path, date, size,
   fingerprint). This is cheap: the image itself isn't decoded.
2. **Show** (`PhotoGrid.tsx`): `<img src="yaadein://original/p_123">`. The `yaadein://` protocol
   (registered in `main.cjs`) maps the id to the real file. The UI never sees raw disk paths in URLs.
3. **Process** (`processor.ts`):
   `fetch(original)` → `createImageBitmap` → canvas → a 480px JPEG thumbnail, saved via
   `api.desktop.saveMedia('thumb', …)`. The grid switches to `yaadein://thumb/p_123`.
   On a 1024px copy it then runs face detection (box + 128-number descriptor + a small face-crop
   JPEG) and MobileNet (top-5 labels → categories). The result is saved with `api.desktop.saveAi(…)`.
4. **Group** (`clusterFaces.ts`): new faces join the nearest person, or form new people.
5. **Search** (`search.ts`): each photo gets one lowercase text containing names, labels, year,
   folder and so on. A query matches when every word appears in that text.
6. **Organize** (`organizer.cjs`): a plan of `{from, to}` operations is shown as a preview,
   applied, and logged for undo.

## How do I…

**…add a new page?** Create `src/pages/MyPage.tsx`, then add a `<Route>` and a `NAV` entry in `App.tsx`.

**…add a new backend action?**
1. In `electron/main.cjs`: `handle('thing:do', (payload) => { … return result; })`
2. Add `'thing:do'` to the allow-list in `electron/preload.cjs`
3. Add a method in `DesktopApi` (`client.ts`) and its one-liner in `electronApi.ts`
4. Call `await api.desktop!.doThing()` from any component.

**…add a search synonym?** Add it to `SYNONYMS` in `src/utils/search.ts` (e.g. `chai: ['cup', 'coffee mug']`).

**…add a category?** Add its emoji to `CATEGORIES` and the ImageNet names to `NAMES` in `src/ai/categories.ts`.

**…change the look?** All colours are CSS variables in `src/styles/theme.css`. Components are in `src/styles/app.css`, in the same order as the components.

## Why these choices?

- **JSON file instead of a database:** no native modules to compile, so `npm install` just works.
  50,000 photos is only a few MB.
- **AI in the renderer, not in Node:** the browser engine decodes images and runs TensorFlow on
  the GPU through WebGL, without any native installs.
- **HashRouter:** the app is loaded from `yaadein://app/index.html` (or inside Capacitor), where
  normal `/people` URLs can't be served by a web server.
- **Copy by default, undo log, `_Duplicates` instead of delete:** it's your family's memories.
  Mistakes must be reversible.
