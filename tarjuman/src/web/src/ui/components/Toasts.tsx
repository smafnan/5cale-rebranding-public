import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useEffect } from 'react';

import { useAppStore } from '../../state/store';
import type { Notice } from '../../state/types';
import { controller } from '../controller';

const AUTO_DISMISS_MS = 6_000;

const ICON = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert } as const;

function Toast({ notice }: { notice: Notice }) {
  const Icon = ICON[notice.level];
  const transient = notice.level === 'info' || notice.level === 'success';

  useEffect(() => {
    if (!transient) return;
    const timer = setTimeout(() => controller().dismissNotice(notice.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notice.id, transient]);

  return (
    <div className={`toast toast--${notice.level}`}>
      <Icon size={16} aria-hidden="true" />
      <span className="toast__text">{notice.message}</span>
      <button
        type="button"
        className="icon-button"
        aria-label="Dismiss"
        onClick={() => controller().dismissNotice(notice.id)}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Transient messages. Rendered once on the page and once inside any open dialog (see Dialog). */
export function Toasts() {
  const notices = useAppStore((state) => state.notices);
  return (
    <div className="toasts" aria-live="polite">
      {notices.map((notice) => (
        <Toast key={notice.id} notice={notice} />
      ))}
    </div>
  );
}
