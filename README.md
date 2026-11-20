# Yaadein (यादें) — your memories, organised

A private, Google-Photos-style photo app that **organises photos on your own hard disk**.
It runs as a **desktop app** (Windows / macOS / Linux) and has a **phone app** that
browses the library over your home Wi-Fi.

| | |
|---|---|
| 💽 **Sources** | Any folder or whole external hard disk · Google Drive (all photos) · Google Photos (picker) · Google Takeout exports |
| 🗓️ **Timeline** | Justified photo grid by month, “On this day” memories, full-screen viewer with details, map link and keyboard shortcuts |
| 🧑‍🤝‍🧑 **People** | Finds faces and groups them into people automatically. You name them, merge them, and fix mistakes |
| ✨ **Things** | Recognises 1,000 kinds of objects and scenes (dogs, food, beaches, cars, documents…) |
| 🔎 **Search & filters** | Search by name, thing, year, month, folder, camera. Filter chips for people, things, year, videos, favourites, location and source |
| 🪄 **Organize on disk** | Copy or move into `Year/Month`, `People/Name`, `Things/Category` folders. Preview first, **undo** any run |
| 🧹 **Duplicates** | Finds byte-identical copies and moves the extras to `_Duplicates`. Nothing is ever deleted |
| 📱 **Phone** | Scan a QR code, or install the Android/iOS app (Capacitor) |
| 🔒 **Private** | All AI runs on your computer (TensorFlow.js). No server, no upload, no account |

---

## 1. Requirements

- **Node.js 22 or newer** — <https://nodejs.org> (LTS installer)
- Windows 10/11, macOS 12+, or Linux
- For the Android app (optional): **Android Studio**. For iOS: a Mac with **Xcode**.

## 2. Run it (5 minutes)

```bash
# 1. unzip, then in a terminal inside the folder:
npm install            # also copies the face-recognition models into public/models

# 2a. Development mode (hot reload — best while you read/change the code)
npm run dev

# 2b. Or run the production build
npm start
```

Optional, once, with internet: `npm run download-models` saves the object-recognition model
(~14 MB) inside the app so “Things” works fully offline. Without it, the app downloads the
model the first time it runs.

Tests: `npm test` (scan → organize → undo → duplicates, plus face grouping).

## 3. First use

1. **Sources → Add folder or drive** → choose your hard disk (e.g. `E:\` or `/Volumes/MyDisk`) or any photo folder.
   Yaadein finds every photo/video in every sub-folder and reads dates from EXIF, file names
   (`IMG_20210314…`, WhatsApp) and Google Takeout `.json` files.
2. A progress ring in the top bar shows the **background analysis** (thumbnails → faces → objects).
   You can pause it. It continues where it stopped the next time you open the app.
3. **People** → click a face → type a name. Now you can search for that name everywhere.
   Use **Same person as…** to merge groups and **Fix wrong faces** to remove mistakes.
4. **Search**: try `riya beach 2023`, `dog`, `wedding`, `screenshot`, `video`, a folder name or a year.
5. **Organize** → pick a style → choose a target folder → **Preview** → **Copy/Move**. Every run can be undone in **History**.
6. **Duplicates** → **Find duplicates** → choose which copy to keep → move the extras aside.

> **Safety:** Yaadein never deletes your photos. “Remove source” only makes the app forget
> them. Copy is the default, a move can be undone, and duplicates are only moved into `_Duplicates` folders.

## 4. Build installers

```bash
npm run dist:win     # → release/Yaadein Setup 1.0.0.exe   (run on Windows)
npm run dist:mac     # → release/Yaadein-1.0.0.dmg         (run on a Mac)
npm run dist:linux   # → release/Yaadein-1.0.0.AppImage
```
Each installer is built on its own OS. The installers are not code-signed, so Windows SmartScreen
or macOS Gatekeeper will warn on first launch. Click “More info → Run anyway” on Windows, or
right-click → Open on a Mac.

### Automatic installers on GitHub (recommended)
This repo includes `.github/workflows/release.yml`. To publish a version:
```bash
# bump "version" in package.json first, e.g. 1.0.1
git tag v1.0.1
git push --tags
```
GitHub builds the Windows, macOS and Linux installers on its own machines and attaches them to a
**Release**. The website in `site/` (deployed on Vercel) always links to the newest one.

## 5. Phone

Your photos stay on the disk attached to your computer. The phone **views** them over Wi-Fi.
On the desktop: **Phone → switch on Phone access**. You'll see a QR code, an address and a pairing code.

**Option A — no install (quickest).** Scan the QR code with the phone camera. The app opens in
the browser. Then use *Add to Home screen* to get an icon.

**Option B — real installable app (Android APK / iOS)** with Capacitor:
```bash
npm run mobile:add-android   # once: adds the native Android project (android/ folder)
npm run mobile:android       # builds the web app, syncs it, opens Android Studio
```
In Android Studio: **Build → Build App Bundle(s) / APK(s) → Build APK(s)**. Install the APK on your
phone, or press ▶ with the phone connected by USB. Open the app and enter the address and pairing
code shown on the desktop.
For iPhone: `npm run mobile:add-ios`, then `npm run mobile:ios` on a Mac. In Xcode, select your
phone and press ▶. Add *NSAllowsLocalNetworking = YES* under *App Transport Security* in
`ios/App/App/Info.plist` so the app can reach your computer.

If the phone can't connect: make sure both devices are on the **same home Wi-Fi**, and click
**Allow** when Windows Firewall asks.

## 6. Google Drive & Google Photos

Google requires every app to have its own (free) API key. You only do this once:

1. <https://console.cloud.google.com> → create a project named **Yaadein**.
2. **APIs & Services → Library** → enable **Google Drive API** and **Google Photos Picker API**.
3. **Google Auth Platform → Branding**: app name + your email. **Audience**: *External*, and add
   each Gmail address you want to connect as a **Test user**.
4. **Clients → Create client → Desktop app** → copy the **Client ID** and **Client secret**.
5. In Yaadein: **Settings → Google API key** → paste → Save.
6. **Sources** → choose an **Import folder** on your hard disk → **Connect account**. Your browser
   opens. Sign in and allow access. Repeat for each Google account.

Then for each account:
- **Import all from Drive**: downloads every photo and video in that Drive into
  `Import folder/Google Drive - you@gmail.com/`.
- **Pick from Google Photos**: Google's picker opens in the browser. Select photos or whole
  albums and press **Done**. They download into `Import folder/Google Photos - you@gmail.com/`.

**About Google Photos:** since 31 March 2025, Google doesn't let any third-party app read a whole
Google Photos library. Apps can only receive photos you pick in Google's own picker. To copy
**everything**:
<https://takeout.google.com> → *Deselect all* → tick **Google Photos** → export → unzip onto your
hard disk → **Sources → Add Google Takeout folder**. Yaadein reads Takeout's `.json` files to recover
the real date and GPS of every photo.

## 7. Where things are stored

| What | Where |
|---|---|
| Your photos | Exactly where they were (Yaadein indexes them in place) |
| Library index (`library.json`) + thumbnails / face crops cache | Windows `%APPDATA%\Yaadein` · macOS `~/Library/Application Support/Yaadein` · Linux `~/.config/Yaadein` |
| Google downloads | The Import folder you chose |

To try the app with a separate test library: `YAADEIN_DATA_DIR=/some/folder npm run dev`.

## 8. Troubleshooting

- **Things page says the object model couldn't load**: you were offline on first run. Run `npm run download-models` once.
- **People are split or mixed**: Settings → *Face grouping strictness* (lower = stricter), then use *Merge* / *Fix wrong faces*.
- **HEIC (iPhone) photos**: supported. They're converted for display, so the first pass is a bit slower.
- **Disk not found after reconnecting**: Windows can give the drive a different letter (e.g. `E:` becomes `F:`). Give it the old letter back in *Disk Management*, or remove the source and add the new path (those photos are analysed again).
- **Analysis is slow**: it uses your graphics card through WebGL. On older laptops expect roughly 1–3 photos per second, and you can keep using the app meanwhile.

## 9. Read the code

Start with **[CODE-TOUR.md](CODE-TOUR.md)**. It explains the architecture and the reading order
for a frontend developer. Every file also opens with a header comment that explains what it does.

---
Stack: Electron · React 19 · TypeScript · Vite · Zustand · React Router · TensorFlow.js
(face-api + MobileNet) · exifr · heic2any · Capacitor. All free and open source.
