import type { ErrorCode, ProviderKind, ProviderStatus } from '../../shared/protocol';
import { ProviderError, type ProviderBase, type ProviderErrorKind } from './types';

/**
 * Ordered fallback over interchangeable providers, with per-provider health tracking.
 *
 * Free tiers are small and rate limited, so a single provider cannot be trusted to
 * answer every request of a live call. The chain tries providers in order and moves
 * on immediately when one is unconfigured, cooling down, over its per-minute budget,
 * or fails. Health state lives here so providers themselves stay stateless.
 */

const MINUTE_MS = 60_000;

const RATE_LIMIT_DEFAULT_COOLDOWN_MS = 20_000;
const RATE_LIMIT_MAX_COOLDOWN_MS = 10 * MINUTE_MS;
const FAILURE_BASE_COOLDOWN_MS = 5_000;
const FAILURE_MAX_COOLDOWN_MS = MINUTE_MS;
/** Consecutive `bad_request` answers before we assume the provider itself is misconfigured. */
const BAD_REQUEST_STRIKES = 3;

export interface Attempt {
  providerId: string;
  outcome: 'ok' | ProviderErrorKind;
  ms: number;
  message?: string;
}

/** No provider of this kind has an API key (or all of them reject the request's language). */
export class NoProviderError extends Error {
  readonly code: ErrorCode = 'unconfigured';
  constructor(
    readonly kind: ProviderKind,
    message: string,
  ) {
    super(message);
    this.name = 'NoProviderError';
  }
}

/** Every usable provider was tried and failed. */
export class ChainExhaustedError extends Error {
  readonly code: ErrorCode;
  constructor(
    readonly kind: ProviderKind,
    readonly attempts: Attempt[],
  ) {
    const summary = attempts.map((a) => `${a.providerId}: ${a.message ?? a.outcome}`).join(' | ');
    super(`All ${kind.toUpperCase()} providers failed — ${summary}`);
    this.name = 'ChainExhaustedError';
    const outcomes = attempts.map((a) => a.outcome);
    this.code = outcomes.every((o) => o === 'rate_limit')
      ? 'rate_limited'
      : outcomes.every((o) => o === 'timeout')
        ? 'timeout'
        : 'provider_failed';
  }
}

export class AbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortedError';
  }
}

interface Health {
  cooldownUntil: number;
  consecutiveFailures: number;
  badRequestStrikes: number;
  /** Set when the provider rejected our credentials; cleared when keys change. */
  authRejected: boolean;
  lastError: string | undefined;
  /** Start times of requests in the last minute, for the client-side RPM budget. */
  recent: number[];
}

export interface ChainOptions {
  now?: () => number;
  /** Called whenever a provider's visible state changes. */
  onStatusChange?: () => void;
}

export interface RunOptions<P> {
  signal: AbortSignal;
  /** Restrict the run to providers that can handle this request (e.g. language support). */
  filter?: (provider: P) => boolean;
  /** Per-request preference: lower ranks are tried first, ties keep the configured order. */
  rank?: (provider: P) => number;
  /**
   * Hedging: when a provider has not answered after this many ms, start the next one in
   * parallel and take whichever succeeds first. Trades a little quota for a bounded delay,
   * which matters more than anything else in a live conversation.
   */
  hedgeAfterMs?: number;
}

export interface RunResult<T, P> {
  value: T;
  provider: P;
  attempts: Attempt[];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class FallbackChain<P extends ProviderBase> {
  private readonly health = new Map<string, Health>();
  private readonly now: () => number;
  private readonly onStatusChange: () => void;

  constructor(
    readonly kind: ProviderKind,
    readonly providers: readonly P[],
    options: ChainOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.onStatusChange = options.onStatusChange ?? (() => undefined);
    for (const provider of providers) {
      this.health.set(provider.id, {
        cooldownUntil: 0,
        consecutiveFailures: 0,
        badRequestStrikes: 0,
        authRejected: false,
        lastError: undefined,
        recent: [],
      });
    }
  }

  private healthOf(provider: P): Health {
    const health = this.health.get(provider.id);
    if (!health) throw new Error(`unknown provider ${provider.id}`);
    return health;
  }

  private overBudget(provider: P, health: Health, now: number): boolean {
    if (!provider.requestsPerMinute) return false;
    health.recent = health.recent.filter((t) => now - t < MINUTE_MS);
    return health.recent.length >= provider.requestsPerMinute;
  }

  /**
   * Decide which providers to try, in which order.
   * @throws NoProviderError when nothing is configured for this request.
   */
  private plan(options: RunOptions<P>): P[] {
    const now = this.now();
    const usable: P[] = [];
    const resting: P[] = [];
    for (const provider of this.providers) {
      if (!provider.isConfigured()) continue;
      if (options.filter && !options.filter(provider)) continue;
      const health = this.healthOf(provider);
      if (health.authRejected) continue;
      if (health.cooldownUntil > now || this.overBudget(provider, health, now)) resting.push(provider);
      else usable.push(provider);
    }

    if (usable.length > 0) {
      const rank = options.rank;
      if (!rank) return usable;
      // Array.prototype.sort is stable, so equal ranks keep the configured order.
      return usable.slice().sort((a, b) => rank(a) - rank(b));
    }

    // Everything is resting. Still try the provider that recovers soonest rather than failing
    // a live utterance outright: cooldowns are estimates, not guarantees.
    const soonest = resting
      .slice()
      .sort((a, b) => this.healthOf(a).cooldownUntil - this.healthOf(b).cooldownUntil)
      .slice(0, 1);
    if (soonest.length > 0) return soonest;

    const anyConfigured = this.providers.some((p) => p.isConfigured());
    throw new NoProviderError(
      this.kind,
      anyConfigured
        ? `No ${this.kind.toUpperCase()} provider is currently usable (credentials rejected or language unsupported).`
        : `No ${this.kind.toUpperCase()} provider is configured. Add a free API key in Settings.`,
    );
  }

  /**
   * Run `operation` against providers in order until one succeeds.
   *
   * @throws NoProviderError      nothing is configured for this request
   * @throws ChainExhaustedError  every usable provider failed
   * @throws AbortedError         `options.signal` fired
   */
  run<T>(
    operation: (provider: P, signal: AbortSignal) => Promise<T>,
    options: RunOptions<P>,
  ): Promise<RunResult<T, P>> {
    if (options.signal.aborted) return Promise.reject(new AbortedError());
    let order: P[];
    try {
      order = this.plan(options);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    return new Promise<RunResult<T, P>>((resolve, reject) => {
      const attempts: Attempt[] = [];
      const controllers = new Set<AbortController>();
      const timers = new Set<ReturnType<typeof setTimeout>>();
      let settled = false;
      let nextIndex = 0;
      let active = 0;

      const settle = (complete: () => void) => {
        if (settled) return;
        settled = true;
        for (const timer of timers) clearTimeout(timer);
        for (const controller of controllers) controller.abort();
        options.signal.removeEventListener('abort', onAbort);
        complete();
      };
      const onAbort = () => settle(() => reject(new AbortedError()));
      options.signal.addEventListener('abort', onAbort, { once: true });

      const launch = (): boolean => {
        const provider = order[nextIndex];
        if (settled || !provider) return false;
        nextIndex += 1;

        const health = this.healthOf(provider);
        const startedAt = this.now();
        // Only providers with a per-minute budget need their request times remembered;
        // recording them for the others would grow without bound over a long call.
        if (provider.requestsPerMinute) {
          health.recent = health.recent.filter((t) => startedAt - t < MINUTE_MS);
          health.recent.push(startedAt);
        }

        const own = new AbortController();
        controllers.add(own);
        const timeout = AbortSignal.timeout(provider.timeoutMs);
        const signal = AbortSignal.any([own.signal, timeout]);
        active += 1;

        let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
        if (options.hedgeAfterMs !== undefined && nextIndex < order.length) {
          hedgeTimer = setTimeout(() => {
            if (hedgeTimer) timers.delete(hedgeTimer);
            launch();
          }, options.hedgeAfterMs);
          timers.add(hedgeTimer);
        }
        const clearHedge = () => {
          if (!hedgeTimer) return;
          clearTimeout(hedgeTimer);
          timers.delete(hedgeTimer);
        };

        Promise.resolve()
          .then(() => operation(provider, signal))
          .then(
            (value) => {
              active -= 1;
              controllers.delete(own);
              clearHedge();
              if (settled) return;
              attempts.push({ providerId: provider.id, outcome: 'ok', ms: this.now() - startedAt });
              this.recordSuccess(health);
              settle(() => resolve({ value, provider, attempts }));
            },
            (error: unknown) => {
              active -= 1;
              controllers.delete(own);
              clearHedge();
              // Lost a hedged race or the caller aborted: not this provider's fault.
              if (settled) return;
              const providerError = this.normalize(provider, error, timeout.aborted);
              attempts.push({
                providerId: provider.id,
                outcome: providerError.kind,
                ms: this.now() - startedAt,
                message: providerError.message,
              });
              this.recordFailure(health, providerError);
              // If a hedged request is still running, let it finish; otherwise move on.
              if (active === 0 && !launch()) {
                settle(() => reject(new ChainExhaustedError(this.kind, attempts)));
              }
            },
          );
        return true;
      };

      launch();
    });
  }

  private normalize(provider: P, error: unknown, timedOut: boolean): ProviderError {
    if (timedOut) {
      return new ProviderError(provider.id, 'timeout', `no answer within ${provider.timeoutMs} ms`, { cause: error });
    }
    if (error instanceof ProviderError) return error;
    return new ProviderError(provider.id, 'unavailable', describeError(error), { cause: error });
  }

  private recordSuccess(health: Health): void {
    const wasUnhealthy = health.consecutiveFailures > 0 || health.cooldownUntil > 0 || health.lastError !== undefined;
    health.consecutiveFailures = 0;
    health.badRequestStrikes = 0;
    health.cooldownUntil = 0;
    health.lastError = undefined;
    if (wasUnhealthy) this.onStatusChange();
  }

  private recordFailure(health: Health, error: ProviderError): void {
    const now = this.now();
    health.lastError = error.message;
    switch (error.kind) {
      case 'aborted':
        return;
      case 'auth':
        health.authRejected = true;
        break;
      case 'rate_limit': {
        const wait = error.retryAfterMs ?? RATE_LIMIT_DEFAULT_COOLDOWN_MS;
        health.cooldownUntil = now + Math.min(RATE_LIMIT_MAX_COOLDOWN_MS, Math.max(1_000, wait));
        break;
      }
      case 'bad_request':
        // Usually a property of this one request (odd audio, filtered text). Only when it keeps
        // happening do we assume a wrong model id or endpoint and rest the provider.
        health.badRequestStrikes += 1;
        if (health.badRequestStrikes >= BAD_REQUEST_STRIKES) {
          health.badRequestStrikes = 0;
          health.cooldownUntil = now + FAILURE_MAX_COOLDOWN_MS;
        }
        break;
      case 'timeout':
      case 'unavailable':
      case 'bad_response': {
        health.consecutiveFailures += 1;
        const backoff = FAILURE_BASE_COOLDOWN_MS * 2 ** (health.consecutiveFailures - 1);
        health.cooldownUntil = now + Math.min(FAILURE_MAX_COOLDOWN_MS, backoff);
        break;
      }
    }
    this.onStatusChange();
  }

  /** Forget "credentials rejected" and cooldowns, e.g. after the user saved new keys. */
  resetHealth(): void {
    for (const health of this.health.values()) {
      health.authRejected = false;
      health.cooldownUntil = 0;
      health.consecutiveFailures = 0;
      health.badRequestStrikes = 0;
      health.lastError = undefined;
    }
    this.onStatusChange();
  }

  /** True when at least one provider has what it needs to be tried. */
  hasConfigured(): boolean {
    return this.providers.some((provider) => provider.isConfigured());
  }

  status(): ProviderStatus[] {
    const now = this.now();
    return this.providers.map((provider, order) => {
      const health = this.healthOf(provider);
      const base = { id: provider.id, kind: this.kind, label: provider.label, order, requiresKey: provider.requiresKey };
      if (!provider.isConfigured()) {
        return { ...base, state: 'unconfigured' as const, detail: 'API key not set' };
      }
      if (health.authRejected) {
        return { ...base, state: 'disabled' as const, detail: health.lastError ?? 'API key rejected' };
      }
      if (health.cooldownUntil > now) {
        return {
          ...base,
          state: 'cooldown' as const,
          detail: health.lastError,
          cooldownUntil: health.cooldownUntil,
        };
      }
      return { ...base, state: 'ready' as const, detail: health.lastError };
    });
  }
}
