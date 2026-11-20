/**
 * DuplicatesPage — finds byte-for-byte identical photos (the same file saved
 * in WhatsApp, a backup, a Google download…) and parks the extra copies in a
 * "_Duplicates" folder next to them. Nothing is deleted; you decide later.
 */
import { useMemo, useState } from 'react';
import { api } from '../api/client';
import type { DuplicateGroup } from '../api/types';
import { useLibrary } from '../state/useLibrary';
import { Thumb } from '../components/PhotoGrid';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { formatBytes, formatDate, plural } from '../utils/dates';
import { clean } from './OrganizePage';

export function DuplicatesPage() {
  const desktop = api.desktop!;
  const photosById = useLibrary((s) => s.photosById);
  const load = useLibrary((s) => s.load);
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [keep, setKeep] = useState<Record<string, string>>({}); // group hash → photo id to keep
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function scan() {
    setBusy(true);
    setMsg('');
    try {
      const g = await desktop.findDuplicates();
      setGroups(g);
      setKeep(Object.fromEntries(g.map((x) => [x.hash, x.photoIds[0]])));
    } catch (err) {
      setMsg(clean(err));
    } finally {
      setBusy(false);
    }
  }

  async function resolve(list: DuplicateGroup[]) {
    const extras = list.reduce((n, g) => n + g.photoIds.length - 1, 0);
    if (!confirm(`Move ${extras} extra copies into "_Duplicates" folders?\nThey are not deleted — you can undo from Organize → History.`)) return;
    setBusy(true);
    try {
      await desktop.resolveDuplicates(list.map((g) => ({ keepId: keep[g.hash], photoIds: g.photoIds })));
      setGroups((gs) => gs?.filter((g) => !list.includes(g)) || null);
      setMsg(`✅ ${plural(extras, 'copy')} moved aside.`);
      await load();
    } catch (err) {
      setMsg(clean(err));
    } finally {
      setBusy(false);
    }
  }

  const wasted = useMemo(() => (groups || []).reduce((n, g) => n + g.size * (g.photoIds.length - 1), 0), [groups]);

  return (
    <div className="page page--narrow">
      <div className="page-head">
        <h1 className="page-title">Duplicates</h1>
        <div className="page-head__actions">
          <button className="btn btn--primary" onClick={scan} disabled={busy}>
            <Icon name="search" size={16} /> {groups ? 'Scan again' : 'Find duplicates'}
          </button>
        </div>
      </div>
      {msg && <p className="notice">{msg}</p>}

      {!groups && !busy && (
        <EmptyState title="Same photo, saved five times?" text="Photos collected from phones, WhatsApp, backups and Google often exist in several places. Yaadein compares the actual file contents to find exact copies." />
      )}
      {groups && groups.length === 0 && <EmptyState title="No duplicates 🎉" text="Every file in your library is unique." />}

      {groups && groups.length > 0 && (
        <>
          <div className="panel panel--row">
            <p>
              <strong>{plural(groups.length, 'group')}</strong> of identical files · <strong>{formatBytes(wasted)}</strong> could be freed
            </p>
            <button className="btn btn--primary" disabled={busy} onClick={() => resolve(groups)}>
              Move all extra copies aside
            </button>
          </div>

          {groups.slice(0, 200).map((g) => (
            <div key={g.hash} className="dupe">
              <div className="dupe__items">
                {g.photoIds.map((id) => {
                  const p = photosById.get(id);
                  if (!p) return null;
                  const isKeep = keep[g.hash] === id;
                  return (
                    <button key={id} className={`dupe__item ${isKeep ? 'is-keep' : ''}`} onClick={() => setKeep({ ...keep, [g.hash]: id })}>
                      <span className="dupe__thumb">
                        <Thumb photo={p} />
                        <span className="dupe__tag">{isKeep ? 'Keep' : 'Extra copy'}</span>
                      </span>
                      <code className="break">{p.path}</code>
                      <small className="muted">
                        {formatBytes(p.size)} · {formatDate(p.mtime)}
                      </small>
                    </button>
                  );
                })}
              </div>
              <button className="btn" disabled={busy} onClick={() => resolve([g])}>
                Move {g.photoIds.length - 1} aside
              </button>
            </div>
          ))}
          {groups.length > 200 && <p className="muted">Showing the 200 biggest groups. “Move all” handles every group.</p>}
        </>
      )}
    </div>
  );
}
