import { useSyncExternalStore } from 'react';

// One shared one-second clock for every countdown on the page. It runs on setInterval, not
// requestAnimationFrame, so countdowns stay correct while the tab is in the background.
let current = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === undefined) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      for (const notify of listeners) notify();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function subscribeNever(): () => void {
  return () => undefined;
}

function snapshot(): number {
  return current;
}

/** Current time in epoch ms, refreshed once per second while `active` is true. */
export function useNow(active: boolean): number {
  return useSyncExternalStore(active ? subscribe : subscribeNever, snapshot);
}
