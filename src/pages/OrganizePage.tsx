/**
 * OrganizePage — tidy your hard disk into folders, safely.
 *
 *  ① choose a style   ② choose where + copy/move   ③ preview   ④ apply   ↶ undo
 *
 * The preview shows exactly which folders will be created before a single
 * file is touched. Every run is recorded in History with an Undo button.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api/client';
import type { OrganizeHistoryItem, OrganizePlan, OrganizeStyle } from '../api/types';
import { useLibrary } from '../state/useLibrary';
import { Icon } from '../components/Icon';
import { formatDateTime, plural } from '../utils/dates';

const STYLES: Array<{ id: OrganizeStyle; title: string; emoji: string; tree: string[]; note?: string }> = [
  { id: 'date', title: 'By date', emoji: '📅', tree: ['2024/', '  03 - March/', '  12 - December/', '2023/'] },
  { id: 'year', title: 'By year', emoji: '🗓️', tree: ['2024/', '2023/', '2022/'] },
  { id: 'people', title: 'By people', emoji: '🧑‍🤝‍🧑', tree: ['People/', '  Riya/', '  Aman/', '  Maa/'], note: 'Name people first — each named person gets a folder. Always copies (a group photo goes into every person’s folder).' },
  { id: 'things', title: 'By things', emoji: '✨', tree: ['Things/', '  Dogs/', '  Food/', '  Beaches & Water/'] },
  { id: 'source', title: 'Merge folders', emoji: '🗂️', tree: ['Camera/', 'WhatsApp Images/', 'Google Photos - you@gmail.com/'], note: 'Gathers photos from all sources into one place, keeping folder names.' },
];

export function OrganizePage() {
  const desktop = api.desktop!;
  const location = useLocation() as { state?: { photoIds?: string[]; style?: OrganizeStyle } };
  const selectedIds = location.state?.photoIds;
  const settings = useLibrary((s) => s.settings)!;
  const totalPhotos = useLibrary((s) => s.photos.length);
  const ai = useLibrary((s) => s.ai);

  const [style, setStyle] = useState<OrganizeStyle>(location.state?.style || 'date');
  const [action, setAction] = useState<'copy' | 'move'>('copy');
  const [target, setTarget] = useState(settings.organizeTarget || '');
  const [includeUnsorted, setIncludeUnsorted] = useState(false);
  const [plan, setPlan] = useState<OrganizePlan | null>(null);
  const [history, setHistory] = useState<OrganizeHistoryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  const refreshHistory = () => desktop.history().then(setHistory);
  useEffect(() => {
    refreshHistory();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Any change in options invalidates the preview.
  useEffect(() => setPlan(null), [style, action, target, includeUnsorted]);

  const effectiveAction = style === 'people' ? 'copy' : action;

  async function preview() {
    setError('');
    setResult('');
    try {
      setPlan(await desktop.planOrganize({ style, action: effectiveAction, target, photoIds: selectedIds, includeUnsorted }));
    } catch (err) {
      setError(clean(err));
    }
  }

  async function apply() {
    if (!plan) return;
    if (plan.action === 'move' && !confirm(`Move ${plan.ops.length} files into ${target}?\n\nYou can undo this from History.`)) return;
    setBusy(true);
    try {
      const r = await desktop.applyPlan(plan);
      setResult(`✅ ${plural(r.done, 'file')} ${plan.action === 'move' ? 'moved' : 'copied'}${r.errors.length ? ` · ${r.errors.length} failed` : ''}`);
      setPlan(null);
      refreshHistory();
    } catch (err) {
      setError(clean(err));
    } finally {
      setBusy(false);
    }
  }

  // Summarise the plan as a folder tree with counts.
  const tree = useMemo(() => {
    if (!plan) return [];
    const counts = new Map<string, number>();
    for (const op of plan.ops) {
      const rel = op.to.slice(plan.target.length).replace(/^[\\/]/, '');
      const parts = rel.split(/[\\/]/).slice(0, -1);
      const key = parts.join(' / ') || '(top level)';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [plan]);

  return (
    <div className="page page--narrow">
      <h1 className="page-title">Organize your disk</h1>
      <p className="muted">
        {selectedIds ? `Working on ${plural(selectedIds.length, 'selected photo')}.` : `Working on all ${totalPhotos.toLocaleString()} items.`}{' '}
        {ai.running && (style === 'people' || style === 'things') && '⏳ AI is still analysing — run again later to include the rest.'}
      </p>

      <h2 className="step-title">
        <span>1</span> How should folders be arranged?
      </h2>
      <div className="style-grid">
        {STYLES.map((s) => (
          <button key={s.id} className={`style-card ${style === s.id ? 'is-on' : ''}`} onClick={() => setStyle(s.id)}>
            <span className="style-card__emoji">{s.emoji}</span>
            <strong>{s.title}</strong>
            <pre className="style-card__tree">{s.tree.join('\n')}</pre>
            {s.note && <small className="muted">{s.note}</small>}
          </button>
        ))}
      </div>

      <h2 className="step-title">
        <span>2</span> Where, and copy or move?
      </h2>
      <div className="panel">
        <div className="field">
          <label>Target folder (on your hard disk)</label>
          <div className="field__row">
            <code className="field__path">{target || 'No folder chosen'}</code>
            <button
              className="btn"
              onClick={async () => {
                const f = await desktop.pickFolder('Organize photos into…');
                if (f) setTarget(f);
              }}
            >
              <Icon name="folder" size={16} /> Choose…
            </button>
          </div>
        </div>
        <div className="segmented">
          <button className={effectiveAction === 'copy' ? 'is-on' : ''} onClick={() => setAction('copy')}>
            <strong>Copy</strong>
            <small>Originals stay untouched. Safest.</small>
          </button>
          <button className={effectiveAction === 'move' ? 'is-on' : ''} onClick={() => setAction('move')} disabled={style === 'people'}>
            <strong>Move</strong>
            <small>No extra space used. Undo-able.</small>
          </button>
        </div>
        {(style === 'people' || style === 'things') && (
          <label className="toggle-label">
            <input type="checkbox" checked={includeUnsorted} onChange={(e) => setIncludeUnsorted(e.target.checked)} />
            {style === 'people'
              ? 'Also include unnamed people (People/_Unnamed/…) and photos without people (People/_No people)'
              : 'Also include photos with no recognised things (Things/_Other)'}
          </label>
        )}
      </div>

      <h2 className="step-title">
        <span>3</span> Preview, then go
      </h2>
      {error && <p className="notice notice--error">⚠️ {error}</p>}
      {result && <p className="notice notice--ok">{result}</p>}
      <div className="btn-row">
        <button className="btn btn--lg" onClick={preview} disabled={!target || busy}>
          <Icon name="search" size={18} /> Preview
        </button>
        <button className="btn btn--primary btn--lg" onClick={apply} disabled={!plan || !plan.ops.length || busy}>
          <Icon name="wand" size={18} /> {busy ? 'Working…' : plan ? `${effectiveAction === 'move' ? 'Move' : 'Copy'} ${plural(plan.ops.length, 'file')}` : 'Apply'}
        </button>
      </div>

      {plan && (
        <div className="panel plan">
          <p>
            <strong>{plural(plan.ops.length, 'file')}</strong> will be {plan.action === 'move' ? 'moved' : 'copied'} into <code>{plan.target}</code>
            {plan.skipped > 0 && <span className="muted"> · {plan.skipped.toLocaleString()} skipped (already there or nothing to sort by)</span>}
          </p>
          <ul className="plan__tree">
            {tree.slice(0, 60).map(([folder, n]) => (
              <li key={folder}>
                <Icon name="folder" size={16} /> {folder} <span className="muted">{n}</span>
              </li>
            ))}
            {tree.length > 60 && <li className="muted">…and {tree.length - 60} more folders</li>}
          </ul>
        </div>
      )}

      <h2 className="section-title">History</h2>
      {!history.length && <p className="muted">Nothing organized yet.</p>}
      <ul className="history">
        {history.map((h) => (
          <li key={h.id} className={h.undone ? 'is-undone' : ''}>
            <div>
              <strong>{h.label}</strong> · {plural(h.count, 'file')}
              <small className="muted">
                {formatDateTime(h.at)} {h.target && `→ ${h.target}`} {h.errors?.length ? `· ${h.errors.length} errors` : ''}
              </small>
            </div>
            {h.undone ? (
              <span className="muted">Undone</span>
            ) : (
              <button
                className="btn"
                onClick={async () => {
                  if (!confirm('Undo this? Copies will be deleted / moved files go back.')) return;
                  await desktop.undo(h.id);
                  refreshHistory();
                }}
              >
                <Icon name="undo" size={16} /> Undo
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export const clean = (err: unknown) => String((err as Error)?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
