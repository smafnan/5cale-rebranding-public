const clock = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Local wall-clock time as HH:MM:SS. */
export function formatClock(epochMs: number): string {
  return clock.format(epochMs);
}

/** A duration in seconds with one decimal: 1840 -> "1.8 s". */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Time left until a cooldown ends: "42 s", or "1:05 min" from one minute up. */
export function formatCountdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} min`;
}

/** A 0..1 (or 0..1.5) gain as a percentage. */
export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** A speaking-rate multiplier: 1.1 -> "1.10×". */
export function formatRate(value: number): string {
  return `${value.toFixed(2)}×`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Unknown error';
}
