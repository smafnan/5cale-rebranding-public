import { useEffect, type RefObject } from 'react';

/** Close a popover or menu on Escape or on a press outside `container`. */
export function useDismissable(
  open: boolean,
  container: RefObject<HTMLElement | null>,
  onDismiss: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = container.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, container, onDismiss]);
}
