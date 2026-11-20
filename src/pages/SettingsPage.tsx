/**
 * SettingsPage — theme, AI options, Google API key, maintenance.
 */
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useLibrary } from '../state/useLibrary';
import { kickProcessor } from '../ai/processor';
import { Icon } from '../components/Icon';
import { clean } from './OrganizePage';

export function SettingsPage() {
  const desktop = api.desktop!;
  const settings = useLibrary((s) => s.settings)!;
  const setSettings = useLibrary((s) => s.setSettings);
  const load = useLibrary((s) => s.load);
  const [clientId, setClientId] = useState(settings.google.clientId);
  const [clientSecret, setClientSecret] = useState('');
  const [msg, setMsg] = useState('');

  // Jump to the Google section when opened as /settings#google
  useEffect(() => {
    if (window.location.hash.endsWith('#google')) document.getElementById('google')?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const save = async (patch: Record<string, unknown>) => {
    try {
      setSettings(await desktop.updateSettings(patch));
      setMsg('Saved ✓');
      setTimeout(() => setMsg(''), 2000);
    } catch (err) {
      setMsg(clean(err));
    }
  };

  return (
    <div className="page page--narrow">
      <h1 className="page-title">Settings {msg && <small className="muted">{msg}</small>}</h1>

      <section className="panel">
        <h2>Look & feel</h2>
        <div className="segmented">
          <button className={settings.theme === 'dark' ? 'is-on' : ''} onClick={() => save({ theme: 'dark' })}>
            <Icon name="moon" /> <strong>Darkroom</strong>
            <small>Warm, easy on the eyes</small>
          </button>
          <button className={settings.theme === 'light' ? 'is-on' : ''} onClick={() => save({ theme: 'light' })}>
            <Icon name="sun" /> <strong>Album</strong>
            <small>Soft paper tones</small>
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Smart features (on-device AI)</h2>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={settings.aiEnabled}
            onChange={async (e) => {
              await save({ aiEnabled: e.target.checked });
              if (e.target.checked) kickProcessor();
            }}
          />
          Find faces & recognise objects in the background
        </label>
        <div className="field">
          <label>
            Face grouping strictness: <strong>{settings.faceMatchThreshold.toFixed(2)}</strong>
          </label>
          <input
            type="range"
            min={0.38}
            max={0.62}
            step={0.01}
            value={settings.faceMatchThreshold}
            onChange={(e) => setSettings({ ...settings, faceMatchThreshold: Number(e.target.value) })}
            onMouseUp={(e) => save({ faceMatchThreshold: Number((e.target as HTMLInputElement).value) })}
            onTouchEnd={(e) => save({ faceMatchThreshold: Number((e.target as HTMLInputElement).value) })}
          />
          <small className="muted">Lower = stricter (may split one person into two). Higher = looser (may mix siblings). 0.50 is a good start. Applies to new faces.</small>
        </div>
        <button
          className="btn"
          onClick={async () => {
            if (!confirm('Forget all faces, people names and labels, and analyse every photo again?')) return;
            await desktop.resetAi();
            await load();
            kickProcessor();
          }}
        >
          <Icon name="refresh" size={16} /> Re-analyse everything
        </button>
      </section>

      <section className="panel" id="google">
        <h2>Google API key</h2>
        <p className="muted small">Needed only for importing from Google Drive / Google Photos. Free, takes about 5 minutes, done once:</p>
        <ol className="guide">
          <li>
            Open <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">console.cloud.google.com</a> and create a project called “Yaadein”.
          </li>
          <li>
            Enable two APIs: <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">Google Drive API</a> and{' '}
            <a href="https://console.cloud.google.com/apis/library/photospicker.googleapis.com" target="_blank" rel="noreferrer">Google Photos Picker API</a>.
          </li>
          <li>
            Go to <em>Google Auth Platform → Branding</em>, fill in the app name and your email. Under <em>Audience</em> choose <strong>External</strong> and add every Gmail address you'll connect as a <strong>Test user</strong>.
          </li>
          <li>
            Go to <em>Clients → Create client</em>, type <strong>Desktop app</strong>. Copy the Client ID and Client secret below.
          </li>
        </ol>
        <div className="field">
          <label>Client ID</label>
          <input value={clientId} onChange={(e) => setClientId(e.target.value.trim())} placeholder="1234-abc.apps.googleusercontent.com" />
        </div>
        <div className="field">
          <label>Client secret {settings.google.hasClientSecret && <span className="muted">(saved — type to replace)</span>}</label>
          <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value.trim())} placeholder="GOCSPX-…" />
        </div>
        <button className="btn btn--primary" onClick={() => save({ google: { clientId, ...(clientSecret ? { clientSecret } : {}) } })}>
          Save key
        </button>
      </section>

      <section className="panel">
        <h2>About</h2>
        <p className="muted small">
          Yaadein (यादें, “memories”) keeps your library index in your user-data folder. Your photos are never uploaded. AI runs on this computer with TensorFlow.js.
        </p>
      </section>
    </div>
  );
}
