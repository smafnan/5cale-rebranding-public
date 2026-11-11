import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

import { cx } from '../lib/cx';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  className?: string;
  footer?: ReactNode;
  /**
   * Rendered inside the dialog, above its content. A modal dialog makes the rest of the
   * page inert and covers it, so anything that must stay visible and clickable while the
   * dialog is open (the toast region) has to live in here.
   */
  overlay?: ReactNode;
  children: ReactNode;
}

/**
 * Modal dialog on the native <dialog> element: Escape closes it, focus is trapped while it
 * is open and returns to the opening control afterwards. The content is only mounted while
 * the dialog is open.
 */
export function Dialog({ open, onClose, title, icon, className, footer, overlay, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx('dialog', className)}
      aria-labelledby={titleId}
      onClose={onClose}
      // A press on the backdrop targets the <dialog> itself; its content fills the whole box.
      // Requiring press and release on the backdrop keeps a text selection that ends
      // outside the box from closing the dialog.
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === event.currentTarget) event.currentTarget.close();
        pressedBackdrop.current = false;
      }}
    >
      {open ? (
        <div className="dialog__frame">
          <header className="dialog__header">
            {icon}
            <h2 className="dialog__title" id={titleId}>
              {title}
            </h2>
            <button
              type="button"
              className="icon-button"
              aria-label={`Close ${title}`}
              title="Close"
              onClick={() => ref.current?.close()}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div className="dialog__body">{children}</div>
          {footer ? <footer className="dialog__footer">{footer}</footer> : null}
          {overlay}
        </div>
      ) : null}
    </dialog>
  );
}
