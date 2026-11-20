/**
 * App.tsx — layout (sidebar / bottom tabs), routes and app start-up.
 *
 * Start-up sequence:
 *   1. load the library from the backend (desktop IPC or phone HTTP)
 *   2. listen for "library changed" + job progress events
 *   3. start the background AI processor (desktop only)
 *
 * Routing uses HashRouter (#/people) because the app is loaded from a custom
 * protocol / file, where normal "/people" URLs can't be served by a web server.
 */
import { useEffect, useState } from 'react';
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { api } from './api/client';
import { getRemoteConfig } from './api/remoteApi';
import { useLibrary } from './state/useLibrary';
import { kickProcessor } from './ai/processor';
import { Icon, type IconName } from './components/Icon';
import { SearchBar } from './components/SearchBar';
import { AiPill, JobToasts } from './components/Activity';
import { PhotosPage, FavoritesPage } from './pages/PhotosPage';
import { PeoplePage, PersonPage } from './pages/PeoplePage';
import { ThingsPage } from './pages/ThingsPage';
import { SourcesPage } from './pages/SourcesPage';
import { OrganizePage } from './pages/OrganizePage';
import { DuplicatesPage } from './pages/DuplicatesPage';
import { PhonePage, ConnectPage } from './pages/PhonePage';
import { SettingsPage } from './pages/SettingsPage';

/** Sidebar entries. `desktopOnly` items are hidden on the phone. */
const NAV: Array<{ to: string; label: string; icon: IconName; desktopOnly?: boolean; group?: string }> = [
  { to: '/', label: 'Photos', icon: 'photos' },
  { to: '/people', label: 'People', icon: 'people' },
  { to: '/things', label: 'Things', icon: 'things' },
  { to: '/favorites', label: 'Favourites', icon: 'heart' },
  { to: '/sources', label: 'Sources', icon: 'disk', desktopOnly: true, group: 'Library' },
  { to: '/organize', label: 'Organize', icon: 'wand', desktopOnly: true },
  { to: '/duplicates', label: 'Duplicates', icon: 'copy', desktopOnly: true },
  { to: '/phone', label: 'Phone', icon: 'phone', desktopOnly: true },
  { to: '/settings', label: 'Settings', icon: 'settings', desktopOnly: true },
];

export default function App() {
  const loaded = useLibrary((s) => s.loaded);
  const error = useLibrary((s) => s.error);
  const settings = useLibrary((s) => s.settings);
  const photoCount = useLibrary((s) => s.photos.length);
  const load = useLibrary((s) => s.load);
  const setJob = useLibrary((s) => s.setJob);
  const [paired, setPaired] = useState(api.mode === 'desktop' || Boolean(getRemoteConfig()));

  // 1 + 2: load and subscribe
  useEffect(() => {
    if (!paired) return;
    load().then(() => kickProcessor());
    const offChange = api.onLibraryChanged(() => load().then(() => kickProcessor()));
    const offJobs = api.onJobProgress(setJob);
    return () => {
      offChange();
      offJobs();
    };
  }, [paired, load, setJob]);

  // Theme → <html data-theme="dark|light">. The phone follows the system setting.
  useEffect(() => {
    const theme = settings?.theme || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.dataset.theme = theme;
  }, [settings?.theme]);

  if (!paired || (api.mode === 'remote' && error)) {
    return <ConnectPage error={error} onConnected={() => (setPaired(true), load())} />;
  }
  if (!loaded) return <Splash />;

  const nav = NAV.filter((n) => api.desktop || !n.desktopOnly);

  return (
    <HashRouter>
      <div className={`app app--${api.mode}`}>
        <aside className="sidebar">
          <div className="brand">
            <span className="brand__mark">य</span>
            <span>
              Yaadein
              <small>{photoCount.toLocaleString()} memories</small>
            </span>
          </div>
          <nav>
            {nav.map((n) => (
              <div key={n.to}>
                {n.group && <div className="sidebar__group">{n.group}</div>}
                <NavLink to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}>
                  <Icon name={n.icon} />
                  <span>{n.label}</span>
                </NavLink>
              </div>
            ))}
          </nav>
          <div className="sidebar__foot">Your photos never leave your devices.</div>
        </aside>

        <main className="main">
          <header className="topbar">
            <SearchBar />
            <AiPill />
            {api.desktop && settings && (
              <button
                className="icon-btn"
                title="Switch theme"
                onClick={async () => useLibrary.getState().setSettings(await api.desktop!.updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' }))}
              >
                <Icon name={settings.theme === 'dark' ? 'sun' : 'moon'} />
              </button>
            )}
          </header>

          <Routes>
            <Route path="/" element={<PhotosPage />} />
            <Route path="/people" element={<PeoplePage />} />
            <Route path="/people/:id" element={<PersonPage />} />
            <Route path="/things" element={<ThingsPage />} />
            <Route path="/favorites" element={<FavoritesPage />} />
            {api.desktop && (
              <>
                <Route path="/sources" element={<SourcesPage />} />
                <Route path="/organize" element={<OrganizePage />} />
                <Route path="/duplicates" element={<DuplicatesPage />} />
                <Route path="/phone" element={<PhonePage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </>
            )}
            <Route path="*" element={<PhotosPage />} />
          </Routes>
        </main>

        {/* Bottom tab bar — only visible on narrow (phone) screens via CSS */}
        <nav className="tabbar">
          {nav.slice(0, 4).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `tab ${isActive ? 'is-active' : ''}`}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>

        <JobToasts />
      </div>
    </HashRouter>
  );
}

function Splash() {
  return (
    <div className="splash">
      <span className="brand__mark brand__mark--pulse">य</span>
      <p>Opening your memories…</p>
    </div>
  );
}
