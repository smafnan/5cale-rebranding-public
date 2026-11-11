import { TriangleAlert } from 'lucide-react';

import { useAppStore } from '../../state/store';
import { chainUsable } from '../lib/providers';

/** Page-wide conditions that keep the product from doing its job. */
export function Banners({ onOpenKeys }: { onOpenKeys: () => void }) {
  const serverKnown = useAppStore((state) => state.server !== null);
  const sttUsable = useAppStore((state) => chainUsable(state.providers.stt));
  const disconnected = useAppStore((state) => state.connection === 'disconnected');
  const canChooseOutput = useAppStore((state) => state.devices.canChooseOutput);
  const devicesKnown = useAppStore((state) => state.devices.inputs.length + state.devices.outputs.length > 0);

  return (
    <div className="banners">
      {disconnected ? (
        <div className="banner banner--danger" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <span className="banner__text">Cannot reach the Tarjuman server. Is it running?</span>
        </div>
      ) : null}
      {serverKnown && !sttUsable ? (
        <div className="banner">
          <TriangleAlert size={18} aria-hidden="true" />
          <span className="banner__text">Speech recognition needs a free API key. Typing still works.</span>
          <button type="button" className="button button--small" onClick={onOpenKeys}>
            Add a key
          </button>
        </div>
      ) : null}
      {devicesKnown && !canChooseOutput ? (
        <div className="banner">
          <TriangleAlert size={18} aria-hidden="true" />
          <span className="banner__text">
            This browser cannot route audio to a chosen device. Use Chrome or Edge on a computer.
          </span>
        </div>
      ) : null}
    </div>
  );
}
