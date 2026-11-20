/**
 * EmptyState — friendly placeholder with an illustration and a call to action.
 * The "polaroid stack" illustration is pure CSS (see .empty__art in app.css).
 */
import type { ReactNode } from 'react';

export function EmptyState({ title, text, action }: { title: string; text: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__art" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  );
}
