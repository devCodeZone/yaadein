/**
 * Backend tests — run with:  npm test
 *
 * They create a fake "hard disk" in a temp folder, scan it, organize it,
 * undo, and detect duplicates. No Electron needed: the backend modules are
 * plain Node.js, which is exactly why they're kept separate from main.cjs.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { LibraryStore } = require('../electron/store.cjs');
const { scanSource, dateFromFilename } = require('../electron/scanner.cjs');
const organizer = require('../electron/organizer.cjs');

/** A small but valid-looking JPEG body (random bytes > 8KB so it isn't skipped). */
function fakeImage(seed) {
  const buf = Buffer.alloc(20 * 1024, seed);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  return buf;
}

function makeDisk() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yaadein-test-'));
  const disk = path.join(root, 'disk');
  fs.mkdirSync(path.join(disk, 'Phone Backup', 'Camera'), { recursive: true });
  fs.mkdirSync(path.join(disk, 'WhatsApp'), { recursive: true });
  fs.mkdirSync(path.join(disk, 'Takeout'), { recursive: true });
  fs.writeFileSync(path.join(disk, 'Phone Backup', 'Camera', 'IMG_20210314_101500.jpg'), fakeImage(1));
  fs.writeFileSync(path.join(disk, 'Phone Backup', 'Camera', 'IMG_20221225_090000.jpg'), fakeImage(2));
  // exact duplicate of the first photo, different name/folder
  fs.writeFileSync(path.join(disk, 'WhatsApp', 'IMG-20210314-WA0001.jpg'), fakeImage(1));
  // Google Takeout photo + side-car json with the real date (1 Jan 2019)
  fs.writeFileSync(path.join(disk, 'Takeout', 'beach.jpg'), fakeImage(3));
  fs.writeFileSync(
    path.join(disk, 'Takeout', 'beach.jpg.supplemental-metadata.json'),
    JSON.stringify({ photoTakenTime: { timestamp: String(Date.UTC(2019, 0, 1, 12) / 1000) }, geoData: { latitude: 15.5, longitude: 73.8 } })
  );
  fs.writeFileSync(path.join(disk, 'notes.txt'), 'not a photo');
  fs.writeFileSync(path.join(disk, 'tiny-icon.png'), Buffer.alloc(100)); // skipped (< 8KB)
  return { root, disk };
}

test('dates are read from file names', () => {
  assert.strictEqual(new Date(dateFromFilename('IMG_20210314_101500.jpg')).getFullYear(), 2021);
  assert.strictEqual(new Date(dateFromFilename('Screenshot_2019-07-04-10-00.png')).getMonth(), 6);
  assert.strictEqual(dateFromFilename('holiday.jpg'), null);
});

test('scan → organize by date (copy) → undo → duplicates', async () => {
  const { root, disk } = makeDisk();
  const store = new LibraryStore(path.join(root, 'data'));
  const source = { id: 's_test', kind: 'folder', path: disk, label: 'disk' };
  store.data.sources.push(source);

  // --- scan
  const stats = await scanSource(store, source);
  assert.strictEqual(stats.added, 4, 'finds 4 photos, ignores txt + tiny icon');
  const photos = Object.values(store.data.photos);
  const beach = photos.find((p) => p.name === 'beach.jpg');
  assert.strictEqual(new Date(beach.takenAt).getUTCFullYear(), 2019, 'Takeout date used');
  assert.strictEqual(beach.dateSource, 'takeout');
  assert.deepStrictEqual(beach.gps, { lat: 15.5, lng: 73.8 });

  // --- rescan is incremental
  const again = await scanSource(store, source);
  assert.strictEqual(again.added + again.updated, 0);

  // --- organize by date, copy
  const target = path.join(root, 'Organized');
  const plan = organizer.planOrganize(store, { style: 'date', action: 'copy', target });
  assert.strictEqual(plan.ops.length, 4);
  const res = await organizer.applyPlan(store, plan);
  assert.strictEqual(res.errors.length, 0);
  assert.ok(fs.existsSync(path.join(target, '2021', '03 - March', 'IMG_20210314_101500.jpg')));
  assert.ok(fs.existsSync(path.join(target, '2022', '12 - December', 'IMG_20221225_090000.jpg')));

  // planning again skips files that are already there
  const plan2 = organizer.planOrganize(store, { style: 'date', action: 'copy', target });
  assert.strictEqual(plan2.ops.length, 0);

  // --- undo removes the copies and empty folders, originals untouched
  await organizer.undoBatch(store, res.batchId);
  assert.ok(!fs.existsSync(path.join(target, '2021')));
  assert.ok(fs.existsSync(path.join(disk, 'Phone Backup', 'Camera', 'IMG_20210314_101500.jpg')));

  // --- move + undo keeps library paths in sync
  const movePlan = organizer.planOrganize(store, { style: 'year', action: 'move', target });
  const moved = await organizer.applyPlan(store, movePlan);
  const movedPhoto = Object.values(store.data.photos).find((p) => p.name === 'IMG_20221225_090000.jpg');
  assert.ok(movedPhoto.path.startsWith(target));
  assert.ok(fs.existsSync(movedPhoto.path));
  await organizer.undoBatch(store, moved.batchId);
  assert.ok(movedPhoto.path.startsWith(disk));
  assert.ok(fs.existsSync(movedPhoto.path));

  // --- duplicates
  const groups = await organizer.findDuplicates(store);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].photoIds.length, 2);
  const dupPlan = organizer.planDuplicateMoves(store, [{ keepId: groups[0].photoIds[0], photoIds: groups[0].photoIds }]);
  assert.strictEqual(dupPlan.ops.length, 1);
  assert.ok(dupPlan.ops[0].to.includes('_Duplicates'));

  // --- people style copies a group photo into each person's folder
  const photoA = Object.values(store.data.photos)[0];
  store.data.people = { pr_1: { id: 'pr_1', name: 'Riya' }, pr_2: { id: 'pr_2', name: 'Aman' } };
  store.data.faces = {
    f_1: { id: 'f_1', photoId: photoA.id, personId: 'pr_1' },
    f_2: { id: 'f_2', photoId: photoA.id, personId: 'pr_2' },
  };
  photoA.faceIds = ['f_1', 'f_2'];
  const peoplePlan = organizer.planOrganize(store, { style: 'people', action: 'move', target });
  assert.strictEqual(peoplePlan.action, 'copy', 'people style is always copy');
  assert.deepStrictEqual(peoplePlan.ops.map((o) => path.basename(path.dirname(o.to))).sort(), ['Aman', 'Riya']);

  // --- store persists
  store.flush();
  const reopened = new LibraryStore(path.join(root, 'data'));
  assert.strictEqual(Object.keys(reopened.data.photos).length, 4);
});
