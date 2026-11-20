/**
 * Activity.tsx — progress UI for background work.
 *   <AiPill/>     small pill in the top bar: "✨ Analysing 120 / 4,000" + pause
 *   <JobToasts/>  stacked cards bottom-right for scans, imports, organizing
 */
import { useLibrary } from '../state/useLibrary';
import { Icon } from './Icon';

export function AiPill() {
  const ai = useLibrary((s) => s.ai);
  const setAi = useLibrary((s) => s.setAi);
  if (!ai.running && !ai.error) return null;
  const pct = ai.total ? Math.round((ai.done / ai.total) * 100) : 0;

  if (ai.error) {
    return (
      <span className="ai-pill ai-pill--error" title={ai.error}>
        ⚠️ AI stopped: {ai.error.slice(0, 40)}
      </span>
    );
  }
  return (
    <span className="ai-pill" title={ai.current ? `Now: ${ai.current}` : undefined}>
      <span className="ai-pill__ring" style={{ ['--pct' as string]: `${pct}%` }} />
      <span>
        {ai.paused ? 'Paused' : 'Analysing'} {ai.done.toLocaleString()} / {ai.total.toLocaleString()}
      </span>
      <button className="icon-btn icon-btn--sm" onClick={() => setAi({ paused: !ai.paused })} title={ai.paused ? 'Resume' : 'Pause'}>
        <Icon name={ai.paused ? 'play' : 'pause'} size={14} filled />
      </button>
    </span>
  );
}

export function JobToasts() {
  const jobs = useLibrary((s) => s.jobs);
  const list = Object.values(jobs);
  if (!list.length) return null;
  return (
    <div className="toasts">
      {list.map((j) => {
        const pct = j.total ? Math.round(((j.done || 0) / j.total) * 100) : null;
        return (
          <div key={j.id} className={`toast ${j.error ? 'toast--error' : j.finished ? 'toast--done' : ''}`}>
            <div className="toast__head">
              <strong>{j.title}</strong>
              {j.finished && !j.error && <Icon name="check" size={16} />}
            </div>
            <small className="toast__msg">{j.error || j.message}</small>
            {!j.finished && (
              <div className={`bar ${pct === null ? 'bar--indeterminate' : ''}`}>
                <span style={{ width: `${pct ?? 30}%` }} />
              </div>
            )}
            {pct !== null && !j.finished && (
              <small className="muted">
                {(j.done || 0).toLocaleString()} / {(j.total || 0).toLocaleString()}
              </small>
            )}
          </div>
        );
      })}
    </div>
  );
}
