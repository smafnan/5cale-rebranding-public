import { useEffect } from 'react';

import { useAppStore } from '../../state/store';
import { controller } from '../controller';

// Space keeps its normal meaning (typing, activating a control) while focus is in one of these.
const INTERACTIVE =
  'input, textarea, select, button, summary, a[href], [role="tab"], [contenteditable]:not([contenteditable="false"])';

function spaceBelongsToThePage(target: EventTarget | null): boolean {
  if (document.querySelector('dialog[open]')) return true;
  return target instanceof Element && target.closest(INTERACTIVE) !== null;
}

/** While the microphone is in push-to-talk mode, holding Space opens it. */
export function usePushToTalk(): void {
  const enabled = useAppStore((state) => state.settings.outgoing.micMode === 'push-to-talk');

  useEffect(() => {
    if (!enabled) return;
    let held = false;

    const release = () => {
      if (!held) return;
      held = false;
      controller().setPushToTalk(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (held) {
        // Auto-repeat while holding: keep the page from scrolling.
        event.preventDefault();
        return;
      }
      if (event.repeat || spaceBelongsToThePage(event.target)) return;
      event.preventDefault();
      held = true;
      controller().setPushToTalk(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') release();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
      release();
    };
  }, [enabled]);
}
