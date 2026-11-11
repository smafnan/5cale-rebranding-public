import { getController } from '../app';
import type { AppController } from '../state/types';

let standIn: AppController | null = null;

/**
 * The controller behind every UI action. Normally the engine; the demo page installs an
 * offline stand-in so that nothing touches the network, the microphone or saved settings.
 */
export function controller(): AppController {
  return standIn ?? getController();
}

export function installStandInController(replacement: AppController): void {
  standIn = replacement;
}
