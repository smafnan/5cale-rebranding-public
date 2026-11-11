import { useLayoutEffect } from 'react';

import { useAppStore } from '../../state/store';

/**
 * Reflect the appearance settings on <html>, where the stylesheets pick them up:
 * `data-theme` (system | light | dark), `data-urdu-font` and the `--caption-scale` variable.
 */
export function useAppearance(): void {
  const theme = useAppStore((state) => state.settings.ui.theme);
  const urduFont = useAppStore((state) => state.settings.ui.urduFont);
  const captionScale = useAppStore((state) => state.settings.ui.captionScale);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useLayoutEffect(() => {
    document.documentElement.dataset.urduFont = urduFont;
  }, [urduFont]);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--caption-scale', String(captionScale));
  }, [captionScale]);
}
