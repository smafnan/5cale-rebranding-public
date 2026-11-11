import type { AppController } from '../state/types';
import { createController } from './controller';

let instance: AppController | undefined;

/** The single controller of the page. The UI calls its methods; it is the only writer of the store. */
export function getController(): AppController {
  instance ??= createController();
  return instance;
}
