/**
 * SourcesPage — where your photos come from.
 *
 *   💽 Hard disk / any folder  → indexed IN PLACE (nothing is copied)
 *   📦 Google Takeout folder   → same, plus real dates from Takeout's .json files
 *   🟢 Google Drive            → downloaded into your Import folder on the disk
 *   🌈 Google Photos           → you pick photos/albums in Google's picker,
 *                                they're downloaded into your Import folder
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Source } from '../api/types';
import { useLibrary } from '../state/useLibrary';
import { Icon, type IconName } from '../components/Icon';
import { formatDate, plural } from '../utils/dates';

const KIND: Record<Source['kind'], { icon: IconName; name: string }> = {
  folder: { icon: 'disk', name: 'Folder / hard disk' },
  takeout: { icon: 'copy', name: 'Google Takeout export' },
  gdrive: { icon: 'drive', name: 'Downloaded from Google Drive' },
  gphotos: { icon: 'cloud', name: 'Downloaded from Google Photos' },
};

export function SourcesPage() {
  const desktop = api.desktop!;
  const sources = useLibrary((s) => s.sources);
  const photos = useLibrary((s) => s.photos);
  const settings = useLibrary((s) => s.settings)!;
  const load = useLibrary((s) => s.load);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const count = (id: string) => photos.filter((p) => p.sourceId === id).length;

  /** Wrap an async action with a busy flag + error message. */
  const run = (label: string, fn: () => Promise<unknown>) => async () => {
    setError('');
    setBusy(label);
    try {
      await fn();
      await load();
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy('');
    }
  };

  const addFolder = (kind: Source['kind']) =>
    run('add', async () => {
      const folder = await desktop.pickFolder(kind === 'takeout' ? 'Choose your unzipped Google Takeout folder' : 'Choose a folder or a whole drive');
      if (folder) await desktop.addSource(folder, kind);
    });

  const chooseImportFolder = run('import-folder', async () => {
    const folder = await desktop.pickFolder('Where should Google downloads be saved? (pick a folder on your hard disk)');
    if (folder) await desktop.updateSettings({ importFolder: folder });
  });

  const googleReady = Boolean(settings.google.clientId && settings.google.hasClientSecret);

  return (
    <div className="page page--narrow">
      <h1 className="page-title">Sources</h1>
      <p className="muted">Yaadein reads photos where they already are. Nothing leaves your computer.</p>
      {error && <p className="notice notice--error">⚠️ {error}</p>}

      {/* ---------------- Local folders ---------------- */}
      <section className="panel">
        <div className="panel__head">
          <h2>
            <Icon name="disk" /> Hard disk & folders
          </h2>
          <div className="btn-row">
            <button className="btn btn--primary" onClick={addFolder('folder')} disabled={!!busy}>
              <Icon name="plus" size={16} /> Add folder or drive
            </button>
            <button className="btn" onClick={addFolder('takeout')} disabled={!!busy} title="Unzip your takeout.google.com export first">
              Add Google Takeout folder
            </button>
          </div>
        </div>
        <p className="muted small">
          Tip: pick the root of your external hard disk (e.g. <code>E:\</code> or <code>/Volumes/MyDisk</code>) and every photo inside, in any sub-folder, is found. System folders are skipped automatically.
        </p>

        {sources.length === 0 && <p className="muted">No sources yet.</p>}
        <ul className="source-list">
          {sources.map((s) => (
            <li key={s.id} className="source">
              <span className="source__icon">
                <Icon name={KIND[s.kind].icon} />
              </span>
              <div className="source__body">
                <strong>{s.label}</strong>
                <code className="break">{s.path}</code>
                <small className="muted">
                  {KIND[s.kind].name} · {plural(count(s.id), 'item')} · {s.lastScanAt ? `scanned ${formatDate(s.lastScanAt)}` : 'scanning…'}
                </small>
              </div>
              <button className="icon-btn" title="Scan again for new photos" onClick={run('rescan', () => desktop.rescan(s.id))}>
                <Icon name="refresh" />
              </button>
              <button
                className="icon-btn"
                title="Remove from Yaadein (your files are NOT deleted)"
                onClick={run('remove', async () => {
                  if (confirm(`Remove "${s.label}" from Yaadein?\n\nYour files stay exactly where they are — only the app forgets them.`)) await desktop.removeSource(s.id);
                })}
              >
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------- Google ---------------- */}
      <section className="panel">
        <div className="panel__head">
          <h2>
            <Icon name="cloud" /> Google Drive & Google Photos
          </h2>
        </div>

        <ol className="steps">
          <li className={settings.importFolder ? 'is-done' : ''}>
            <div>
              <strong>Import folder on your hard disk</strong>
              <p className="muted small">Google files are downloaded here, then organised like everything else.</p>
              {settings.importFolder && <code className="break">{settings.importFolder}</code>}
            </div>
            <button className="btn" onClick={chooseImportFolder}>
              {settings.importFolder ? 'Change' : 'Choose folder'}
            </button>
          </li>

          <li className={googleReady ? 'is-done' : ''}>
            <div>
              <strong>Google API key (free, one-time)</strong>
              <p className="muted small">Google requires every app to have its own key. Takes ~5 minutes — follow the guide in Settings.</p>
            </div>
            <Link className="btn" to="/settings#google">
              {googleReady ? 'Edit' : 'Set up'}
            </Link>
          </li>

          <li className={settings.google.accounts.length ? 'is-done' : ''}>
            <div>
              <strong>Connect your Google accounts</strong>
              <p className="muted small">Connect as many accounts as you have — each gets its own import folder.</p>
            </div>
            <button className="btn btn--primary" disabled={!googleReady || !!busy} onClick={run('connect', () => desktop.googleConnect())}>
              {busy === 'connect' ? 'Waiting for browser…' : 'Connect account'}
            </button>
          </li>
        </ol>

        {settings.google.accounts.map((acc) => (
          <div key={acc.id} className="account">
            <span className="account__avatar">{acc.email[0]?.toUpperCase()}</span>
            <strong className="account__email">{acc.email}</strong>
            <button className="btn" disabled={!settings.importFolder || !!busy} onClick={run('drive', () => desktop.importDrive(acc.id))}>
              <Icon name="drive" size={16} /> Import all from Drive
            </button>
            <button className="btn" disabled={!settings.importFolder || !!busy} onClick={run('photos', () => desktop.importPhotos(acc.id))}>
              <Icon name="cloud" size={16} /> {busy === 'photos' ? 'Pick in your browser…' : 'Pick from Google Photos'}
            </button>
            <button className="icon-btn" title="Disconnect" onClick={run('disc', () => desktop.googleDisconnect(acc.id))}>
              <Icon name="x" />
            </button>
          </div>
        ))}

        <details className="explain">
          <summary>Why can't Yaadein copy my WHOLE Google Photos library automatically?</summary>
          <p>
            Since March 2025 Google only allows apps to access photos <em>you pick</em> in Google's own picker (you can select whole albums or many photos at once). To copy
            everything in one go, use <strong>Google Takeout</strong>: go to takeout.google.com → select only “Google Photos” → export → unzip to your hard disk → click “Add Google Takeout folder”
            above. Yaadein reads Takeout's hidden .json files to recover the real date and location of every photo.
          </p>
        </details>
      </section>
    </div>
  );
}
