/**
 * PhonePage (desktop) — switch on phone access and show a QR code.
 * ConnectPage (phone)  — type the computer's address + pairing code.
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api/client';
import type { MobileStatus } from '../api/types';
import { getRemoteConfig, saveRemoteConfig, testRemote } from '../api/remoteApi';
import { Icon } from '../components/Icon';
import { clean } from './OrganizePage';

export function PhonePage() {
  const desktop = api.desktop!;
  const [status, setStatus] = useState<MobileStatus | null>(null);
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    desktop.mobileStatus().then(setStatus);
  }, [desktop]);

  const url = status?.addresses[0] ? `http://${status.addresses[0]}:${status.port}` : '';

  // Draw the QR code whenever the address changes.
  useEffect(() => {
    if (status?.running && url) QRCode.toDataURL(`${url}/?code=${status.token}`, { margin: 1, width: 240, color: { dark: '#1b1410', light: '#fff8ee' } }).then(setQr);
    else setQr('');
  }, [status, url]);

  async function toggle() {
    setError('');
    try {
      setStatus(status?.running ? await desktop.mobileStop() : await desktop.mobileStart());
    } catch (err) {
      setError(clean(err));
    }
  }

  return (
    <div className="page page--narrow">
      <h1 className="page-title">Your phone</h1>
      <p className="muted">Browse, search and favourite your whole library from your phone while it's on the same Wi-Fi as this computer. Photos stay on the disk — the phone just views them.</p>
      {error && <p className="notice notice--error">⚠️ {error}</p>}

      <div className="panel phone">
        <div className="phone__switch">
          <div>
            <strong>Phone access</strong>
            <small className="muted">{status?.running ? 'On — listening on your home network' : 'Off'}</small>
          </div>
          <button className={`switch ${status?.running ? 'is-on' : ''}`} onClick={toggle} aria-pressed={status?.running}>
            <span />
          </button>
        </div>

        {status?.running && (
          <div className="phone__connect">
            {qr && <img className="phone__qr" src={qr} alt="QR code" />}
            <div>
              <p>
                <strong>Option A — any phone browser:</strong> scan the QR code with your camera. Then “Add to Home screen” for an app icon.
              </p>
              <p>
                <strong>Option B — Yaadein mobile app:</strong> enter
              </p>
              <dl className="kv">
                <dt>Address</dt>
                <dd>
                  <code>{url || 'No network found'}</code>
                </dd>
                <dt>Pairing code</dt>
                <dd>
                  <code className="code-big">{status.token}</code>
                </dd>
              </dl>
              {status.addresses.length > 1 && <small className="muted">Other addresses of this computer: {status.addresses.slice(1).join(', ')}</small>}
              {!status.built && <p className="notice">Run <code>npm run build</code> once so the phone has an app to load (dev mode only).</p>}
            </div>
          </div>
        )}
      </div>

      <details className="explain">
        <summary>Phone can't connect?</summary>
        <ul>
          <li>Phone and computer must be on the same Wi-Fi (not mobile data / guest network).</li>
          <li>Windows may ask to allow Yaadein through the firewall — click “Allow” for private networks.</li>
          <li>Office/hotel networks often block device-to-device traffic. Home Wi-Fi or your phone's hotspot works.</li>
        </ul>
      </details>
    </div>
  );
}

/** Phone side: shown when the app isn't paired yet (or pairing broke). */
export function ConnectPage({ onConnected, error }: { onConnected: () => void; error?: string | null }) {
  const saved = getRemoteConfig();
  const [server, setServer] = useState(saved?.server || 'http://192.168.1.');
  const [token, setToken] = useState(saved?.token || '');
  const [msg, setMsg] = useState(error || '');
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    setMsg('');
    const cfg = { server: server.includes(':', 6) ? server : `${server}:7777`, token };
    try {
      if (await testRemote(cfg)) {
        saveRemoteConfig(cfg);
        onConnected();
      } else setMsg('Wrong pairing code.');
    } catch {
      setMsg('Could not reach your computer. Is Phone access switched on and are you on the same Wi-Fi?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="connect">
      <div className="brand brand--big">
        <span className="brand__mark">य</span> Yaadein
      </div>
      <p className="muted">Connect to the Yaadein app on your computer.</p>
      <label>
        Computer address
        <input value={server} onChange={(e) => setServer(e.target.value)} inputMode="url" autoCapitalize="off" />
      </label>
      <label>
        Pairing code
        <input value={token} onChange={(e) => setToken(e.target.value.toUpperCase())} maxLength={6} autoCapitalize="characters" />
      </label>
      {msg && <p className="notice notice--error">{msg}</p>}
      <button className="btn btn--primary btn--lg" onClick={connect} disabled={busy || token.length < 6}>
        <Icon name="wifi" /> {busy ? 'Connecting…' : 'Connect'}
      </button>
      <small className="muted">Find both on your computer: Yaadein → Phone.</small>
    </div>
  );
}
