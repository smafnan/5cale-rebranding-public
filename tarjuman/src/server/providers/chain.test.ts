import { afterEach, describe, expect, it, vi } from 'vitest';

import { deferred, flushMicrotasks, must, type Deferred } from '../../../tests/unit/helpers';
import { AbortedError, ChainExhaustedError, FallbackChain, NoProviderError, type RunOptions } from './chain';
import { ProviderError, type ProviderBase, type ProviderErrorKind } from './types';

interface FakeProvider extends ProviderBase {
  configured: boolean;
}

function provider(id: string, options: Partial<Omit<FakeProvider, 'id' | 'isConfigured'>> = {}): FakeProvider {
  return {
    id,
    kind: 'mt',
    label: `Provider ${id}`,
    requiresKey: true,
    timeoutMs: 5_000,
    configured: true,
    ...options,
    isConfigured() {
      return this.configured;
    },
  };
}

function fail(p: ProviderBase, kind: ProviderErrorKind, extra: { retryAfterMs?: number; message?: string } = {}) {
  return new ProviderError(p.id, kind, extra.message ?? `${p.id} ${kind}`, { retryAfterMs: extra.retryAfterMs });
}

/** A clock the test moves by hand, so cooldown arithmetic is exact. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms), set: (value: number) => (t = value) };
}

/**
 * Scripted operation: each provider id maps to a list of outcomes consumed one per call
 * (the last one repeats). Records the order in which providers were called.
 */
function script(outcomes: Record<string, (ProviderErrorKind | 'ok' | Error)[]>) {
  const calls: string[] = [];
  const counts = new Map<string, number>();
  const operation = async (p: FakeProvider): Promise<string> => {
    calls.push(p.id);
    const list = outcomes[p.id] ?? ['ok'];
    const index = counts.get(p.id) ?? 0;
    counts.set(p.id, index + 1);
    const outcome = list[Math.min(index, list.length - 1)] ?? 'ok';
    if (outcome === 'ok') return `answer from ${p.id}`;
    throw outcome instanceof Error ? outcome : fail(p, outcome);
  };
  return { calls, operation };
}

function opts(extra: Partial<RunOptions<FakeProvider>> = {}): RunOptions<FakeProvider> {
  return { signal: new AbortController().signal, ...extra };
}

/** An operation whose calls stay pending until the test settles them, and which honours the abort signal. */
function controllable() {
  const started: { id: string; signal: AbortSignal; result: Deferred<string> }[] = [];
  const operation = (p: FakeProvider, signal: AbortSignal): Promise<string> => {
    const result = deferred<string>();
    started.push({ id: p.id, signal, result });
    signal.addEventListener('abort', () => result.reject(new ProviderError(p.id, 'aborted', 'request aborted')), {
      once: true,
    });
    return result.promise;
  };
  const call = (id: string) => must(started.find((entry) => entry.id === id), `a call to ${id}`);
  return { started, operation, call, ids: () => started.map((entry) => entry.id) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('FallbackChain: order and selection', () => {
  it('uses the first provider and does not touch the others when it succeeds', async () => {
    const [a, b] = [provider('a'), provider('b')];
    const chain = new FallbackChain('mt', [a, b]);
    const { calls, operation } = script({});

    const result = await chain.run(operation, opts());

    expect(result.value).toBe('answer from a');
    expect(result.provider).toBe(a);
    expect(result.attempts).toEqual([{ providerId: 'a', outcome: 'ok', ms: expect.any(Number) }]);
    expect(calls).toEqual(['a']);
  });

  it('falls through failing providers in configured order and reports every attempt', async () => {
    const chain = new FallbackChain('mt', [provider('a'), provider('b'), provider('c')]);
    const { calls, operation } = script({ a: ['unavailable'], b: ['bad_response'] });

    const result = await chain.run(operation, opts());

    expect(calls).toEqual(['a', 'b', 'c']);
    expect(result.provider.id).toBe('c');
    expect(result.attempts.map((attempt) => [attempt.providerId, attempt.outcome])).toEqual([
      ['a', 'unavailable'],
      ['b', 'bad_response'],
      ['c', 'ok'],
    ]);
    expect(result.attempts[0]?.message).toBe('a unavailable');
  });

  it('skips providers that are not configured', async () => {
    const chain = new FallbackChain('mt', [provider('a', { configured: false }), provider('b')]);
    const { calls, operation } = script({});

    const result = await chain.run(operation, opts());

    expect(calls).toEqual(['b']);
    expect(result.provider.id).toBe('b');
  });

  it('re-reads isConfigured on every run, so a key added later takes effect', async () => {
    const a = provider('a', { configured: false });
    const chain = new FallbackChain('mt', [a, provider('b')]);
    const { calls, operation } = script({});

    await chain.run(operation, opts());
    a.configured = true;
    await chain.run(operation, opts());

    expect(calls).toEqual(['b', 'a']);
  });

  it('restricts the run to providers accepted by the filter', async () => {
    const chain = new FallbackChain('mt', [provider('a'), provider('b'), provider('c')]);
    const { calls, operation } = script({ b: ['unavailable'] });

    const result = await chain.run(operation, opts({ filter: (p) => p.id !== 'a' }));

    expect(calls).toEqual(['b', 'c']);
    expect(result.provider.id).toBe('c');
  });

  it('orders by rank and keeps the configured order among equal ranks', async () => {
    const chain = new FallbackChain('mt', [provider('a'), provider('b'), provider('c'), provider('d')]);
    const { calls, operation } = script({ a: ['unavailable'], b: ['unavailable'], c: ['unavailable'], d: ['unavailable'] });
    const rank = (p: FakeProvider) => (p.id === 'a' ? 2 : p.id === 'd' ? 0 : 1);

    await expect(chain.run(operation, opts({ rank }))).rejects.toBeInstanceOf(ChainExhaustedError);

    expect(calls).toEqual(['d', 'b', 'c', 'a']);
  });

  it('treats a thrown non-ProviderError as "unavailable"', async () => {
    const chain = new FallbackChain('mt', [provider('a'), provider('b')]);
    const { operation } = script({ a: [new TypeError('boom')] });

    const result = await chain.run(operation, opts());

    expect(result.attempts[0]).toMatchObject({ providerId: 'a', outcome: 'unavailable', message: 'boom' });
    expect(chain.status()[0]).toMatchObject({ state: 'cooldown', detail: 'boom' });
  });

  it('treats a synchronous throw like a rejection', async () => {
    const chain = new FallbackChain('mt', [provider('a'), provider('b')]);
    const operation = (p: FakeProvider): Promise<string> => {
      if (p.id === 'a') throw new Error('sync failure');
      return Promise.resolve('fine');
    };

    const result = await chain.run(operation, opts());

    expect(result.value).toBe('fine');
    expect(result.attempts[0]).toMatchObject({ outcome: 'unavailable', message: 'sync failure' });
  });
});

describe('FallbackChain: health', () => {
  it('rests a rate-limited provider for the time the provider asked for', async () => {
    const time = clock();
    const [a, b] = [provider('a'), provider('b')];
    const chain = new FallbackChain('mt', [a, b], { now: time.now });
    const { calls, operation } = script({ a: [fail(a, 'rate_limit', { retryAfterMs: 30_000 }), 'ok'] });

    await chain.run(operation, opts());
    expect(chain.status()[0]).toMatchObject({ state: 'cooldown', cooldownUntil: time.now() + 30_000 });

    time.advance(29_999);
    await chain.run(operation, opts());
    expect(calls).toEqual(['a', 'b', 'b']);

    time.advance(1);
    const result = await chain.run(operation, opts());
    expect(result.provider.id).toBe('a');
    expect(chain.status()[0]).toMatchObject({ state: 'ready' });
    expect(chain.status()[0]?.cooldownUntil).toBeUndefined();
  });

  it('uses a default rate-limit cooldown and clamps absurd hints', async () => {
    const time = clock();
    const cooldownFor = async (retryAfterMs: number | undefined) => {
      const a = provider('a');
      const chain = new FallbackChain('mt', [a, provider('b')], { now: time.now });
      await chain.run(script({ a: [fail(a, 'rate_limit', { retryAfterMs })] }).operation, opts());
      return must(chain.status()[0]?.cooldownUntil) - time.now();
    };

    expect(await cooldownFor(undefined)).toBe(20_000);
    expect(await cooldownFor(0)).toBe(1_000);
    expect(await cooldownFor(24 * 3_600_000)).toBe(600_000);
  });

  it('backs off exponentially on repeated unavailability and timeouts, up to a minute', async () => {
    const time = clock();
    // A single provider keeps being tried even while resting, which lets the failures pile up.
    const chain = new FallbackChain('mt', [provider('a')], { now: time.now });
    const { operation } = script({ a: ['unavailable', 'timeout', 'bad_response', 'unavailable', 'unavailable', 'unavailable'] });

    const cooldowns: number[] = [];
    for (let i = 0; i < 6; i++) {
      await expect(chain.run(operation, opts())).rejects.toBeInstanceOf(ChainExhaustedError);
      cooldowns.push(must(chain.status()[0]?.cooldownUntil) - time.now());
      time.advance(1_000);
    }

    expect(cooldowns).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  });

  it('starts the backoff from scratch after a success', async () => {
    const time = clock();
    const chain = new FallbackChain('mt', [provider('a')], { now: time.now });
    const { operation } = script({ a: ['unavailable', 'unavailable', 'ok', 'unavailable'] });

    await expect(chain.run(operation, opts())).rejects.toBeInstanceOf(ChainExhaustedError);
    await expect(chain.run(operation, opts())).rejects.toBeInstanceOf(ChainExhaustedError);
    await chain.run(operation, opts());
    expect(chain.status()[0]).toMatchObject({ state: 'ready' });
    expect(chain.status()[0]?.detail).toBeUndefined();

    await expect(chain.run(operation, opts())).rejects.toBeInstanceOf(ChainExhaustedError);
    expect(must(chain.status()[0]?.cooldownUntil) - time.now()).toBe(5_000);
  });

  it('disables a provider whose credentials were rejected until health is reset', async () => {
    const time = clock();
    const a = provider('a');
    const chain = new FallbackChain('mt', [a, provider('b')], { now: time.now });
    const { calls, operation } = script({ a: [fail(a, 'auth', { message: 'HTTP 401 — invalid key' }), 'ok'] });

    await chain.run(operation, opts());
    expect(chain.status()[0]).toMatchObject({ state: 'disabled', detail: 'HTTP 401 — invalid key' });

    // Not a cooldown: waiting does not bring it back.
    time.advance(24 * 3_600_000);
    await chain.run(operation, opts());
    expect(calls).toEqual(['a', 'b', 'b']);

    chain.resetHealth();
    expect(chain.status()[0]).toMatchObject({ state: 'ready' });
    const result = await chain.run(operation, opts());
    expect(result.provider.id).toBe('a');
  });

  it('only rests a provider after three consecutive bad requests', async () => {
    const time = clock();
    const chain = new FallbackChain('mt', [provider('a'), provider('b')], { now: time.now });
    const { calls, operation } = script({ a: ['bad_request'] });

    await chain.run(operation, opts());
    await chain.run(operation, opts());
    expect(chain.status()[0]).toMatchObject({ state: 'ready', detail: 'a bad_request' });

    await chain.run(operation, opts());
    expect(chain.status()[0]).toMatchObject({ state: 'cooldown', cooldownUntil: time.now() + 60_000 });

    await chain.run(operation, opts());
    expect(calls).toEqual(['a', 'b', 'a', 'b', 'a', 'b', 'b']);
  });

  it('forgets bad-request strikes after a success', async () => {
    const chain = new FallbackChain('mt', [provider('a'), provider('b')], { now: clock().now });
    const { operation } = script({ a: ['bad_request', 'bad_request', 'ok', 'bad_request', 'bad_request'] });

    for (let i = 0; i < 5; i++) await chain.run(operation, opts());

    expect(chain.status()[0]).toMatchObject({ state: 'ready' });
  });

  it('skips a provider that has used up its per-minute budget instead of provoking a 429', async () => {
    const time = clock();
    const chain = new FallbackChain('mt', [provider('a', { requestsPerMinute: 2 }), provider('b')], { now: time.now });
    const { calls, operation } = script({});

    await chain.run(operation, opts());
    time.advance(10_000);
    await chain.run(operation, opts());
    time.advance(10_000);
    await chain.run(operation, opts());
    expect(calls).toEqual(['a', 'a', 'b']);
    // Budget exhaustion is not a failure and is not shown as one.
    expect(chain.status()[0]).toMatchObject({ state: 'ready' });

    // 60 s after the first request one slot is free again.
    time.advance(40_000);
    await chain.run(operation, opts());
    await chain.run(operation, opts());
    expect(calls).toEqual(['a', 'a', 'b', 'a', 'b']);
  });

  it('counts failed requests against the budget too', async () => {
    const time = clock();
    const chain = new FallbackChain('mt', [provider('a', { requestsPerMinute: 1 }), provider('b')], { now: time.now });
    const { calls, operation } = script({ a: ['bad_request', 'ok'] });

    await chain.run(operation, opts());
    await chain.run(operation, opts());

    expect(calls).toEqual(['a', 'b', 'b']);
  });

  it('does not accumulate request timestamps for providers without a budget', async () => {
    const chain = new FallbackChain('mt', [provider('a')], { now: clock().now });
    const { operation } = script({});

    for (let i = 0; i < 50; i++) await chain.run(operation, opts());

    const health = (chain as unknown as { health: Map<string, { recent: number[] }> }).health;
    expect(must(health.get('a')).recent).toHaveLength(0);
  });

  it('still tries the provider that recovers soonest when every provider is resting', async () => {
    const time = clock();
    const [a, b, c] = [provider('a'), provider('b'), provider('c')];
    const chain = new FallbackChain('mt', [a, b, c], { now: time.now });
    const first = script({
      a: [fail(a, 'rate_limit', { retryAfterMs: 90_000 })],
      b: [fail(b, 'rate_limit', { retryAfterMs: 15_000 })],
      c: [fail(c, 'rate_limit', { retryAfterMs: 45_000 })],
    });
    await expect(chain.run(first.operation, opts())).rejects.toBeInstanceOf(ChainExhaustedError);
    expect(chain.status().map((s) => s.state)).toEqual(['cooldown', 'cooldown', 'cooldown']);

    const second = script({});
    const result = await chain.run(second.operation, opts());

    expect(second.calls).toEqual(['b']);
    expect(result.provider.id).toBe('b');
  });

  it('tries only that one resting provider and fails if it fails', async () => {
    const time = clock();
    const [a, b] = [provider('a'), provider('b')];
    const chain = new FallbackChain('mt', [a, b], { now: time.now });
    const { calls, operation } = script({
      a: [fail(a, 'rate_limit', { retryAfterMs: 5_000 })],
      b: [fail(b, 'rate_limit', { retryAfterMs: 50_000 })],
    });
    await expect(chain.run(operation, opts())).rejects.toBeInstanceOf(ChainExhaustedError);

    const error = await chain.run(operation, opts()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ChainExhaustedError);
    expect((error as ChainExhaustedError).attempts.map((attempt) => attempt.providerId)).toEqual(['a']);
    expect(calls).toEqual(['a', 'b', 'a']);
  });

  it('prefers a healthy provider over a resting one that is earlier in the order', async () => {
    const time = clock();
    const a = provider('a');
    const chain = new FallbackChain('mt', [a, provider('b')], { now: time.now });
    const { calls, operation } = script({ a: ['unavailable', 'ok'] });

    await chain.run(operation, opts());
    await chain.run(operation, opts());

    expect(calls).toEqual(['a', 'b', 'b']);
  });
});

describe('FallbackChain: errors', () => {
  it('throws NoProviderError when nothing is configured', async () => {
    const chain = new FallbackChain('stt', [provider('a', { configured: false }), provider('b', { configured: false })]);
    const { calls, operation } = script({});

    const error = await chain.run(operation, opts()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NoProviderError);
    expect(error).toMatchObject({ name: 'NoProviderError', code: 'unconfigured', kind: 'stt' });
    expect((error as Error).message).toMatch(/No STT provider is configured/);
    expect(calls).toEqual([]);
    expect(chain.hasConfigured()).toBe(false);
  });

  it('throws NoProviderError with a different explanation when the filter excludes every provider', async () => {
    const chain = new FallbackChain('tts', [provider('a'), provider('b')]);

    const error = await chain.run(script({}).operation, opts({ filter: () => false })).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NoProviderError);
    expect(error).toMatchObject({ code: 'unconfigured', kind: 'tts' });
    expect((error as Error).message).toMatch(/currently usable/);
    expect(chain.hasConfigured()).toBe(true);
  });

  it('throws NoProviderError when the only configured provider had its credentials rejected', async () => {
    const chain = new FallbackChain('mt', [provider('a'), provider('b', { configured: false })]);
    const { calls, operation } = script({ a: ['auth'] });
    await expect(chain.run(operation, opts())).rejects.toBeInstanceOf(ChainExhaustedError);

    await expect(chain.run(operation, opts())).rejects.toBeInstanceOf(NoProviderError);
    expect(calls).toEqual(['a']);
  });

  it('throws ChainExhaustedError listing every attempt when all providers fail', async () => {
    const chain = new FallbackChain('mt', [provider('a'), provider('b')]);
    const { operation } = script({ a: ['unavailable'], b: ['bad_response'] });

    const error = (await chain.run(operation, opts()).catch((e: unknown) => e)) as ChainExhaustedError;

    expect(error).toBeInstanceOf(ChainExhaustedError);
    expect(error.name).toBe('ChainExhaustedError');
    expect(error.kind).toBe('mt');
    expect(error.attempts.map((attempt) => [attempt.providerId, attempt.outcome])).toEqual([
      ['a', 'unavailable'],
      ['b', 'bad_response'],
    ]);
    expect(error.message).toContain('All MT providers failed');
    expect(error.message).toContain('a: a unavailable');
    expect(error.message).toContain('b: b bad_response');
  });

  it.each([
    [['rate_limit', 'rate_limit'], 'rate_limited'],
    [['timeout', 'timeout'], 'timeout'],
    [['rate_limit', 'timeout'], 'provider_failed'],
    [['unavailable', 'rate_limit'], 'provider_failed'],
    [['auth', 'bad_request'], 'provider_failed'],
  ] as const)('maps attempt outcomes %j to the error code %s', async (kinds, code) => {
    const chain = new FallbackChain('mt', [provider('a'), provider('b')]);
    const { operation } = script({ a: [kinds[0]], b: [kinds[1]] });

    await expect(chain.run(operation, opts())).rejects.toMatchObject({ code });
  });
});

describe('FallbackChain: deadlines and aborts', () => {
  it('gives every provider its own deadline and moves on when it passes', async () => {
    const slow = provider('slow', { timeoutMs: 25 });
    const chain = new FallbackChain('mt', [slow, provider('fast')]);
    const seen: AbortSignal[] = [];
    const operation = (p: FakeProvider, signal: AbortSignal): Promise<string> => {
      if (p.id === 'fast') return Promise.resolve('fast answer');
      seen.push(signal);
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new ProviderError(p.id, 'aborted', 'request aborted')));
      });
    };

    const result = await chain.run(operation, opts());

    expect(result.value).toBe('fast answer');
    expect(result.attempts[0]).toMatchObject({
      providerId: 'slow',
      outcome: 'timeout',
      message: 'no answer within 25 ms',
    });
    expect(seen[0]?.aborted).toBe(true);
    // A timeout is the provider's fault, unlike a caller abort.
    expect(chain.status()[0]).toMatchObject({ state: 'cooldown', detail: 'no answer within 25 ms' });
  });

  it('reports "timeout" when every provider runs into its deadline', async () => {
    const chain = new FallbackChain('mt', [provider('a', { timeoutMs: 15 }), provider('b', { timeoutMs: 15 })]);
    const operation = (_p: FakeProvider, signal: AbortSignal): Promise<string> =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));

    await expect(chain.run(operation, opts())).rejects.toMatchObject({ name: 'ChainExhaustedError', code: 'timeout' });
  });

  it('rejects at once with AbortedError when the signal is already aborted', async () => {
    const chain = new FallbackChain('mt', [provider('a')]);
    const { calls, operation } = script({});
    const controller = new AbortController();
    controller.abort();

    const error = await chain.run(operation, opts({ signal: controller.signal })).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AbortedError);
    expect((error as Error).name).toBe('AbortedError');
    expect(calls).toEqual([]);
  });

  it('aborts the running provider when the caller aborts, without a health penalty', async () => {
    const time = clock();
    const notifications = vi.fn();
    const chain = new FallbackChain('mt', [provider('a'), provider('b')], { now: time.now, onStatusChange: notifications });
    const op = controllable();
    const controller = new AbortController();

    const pending = chain.run(op.operation, opts({ signal: controller.signal }));
    await flushMicrotasks();
    expect(op.ids()).toEqual(['a']);
    expect(op.call('a').signal.aborted).toBe(false);

    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(AbortedError);
    expect(op.call('a').signal.aborted).toBe(true);
    await flushMicrotasks();
    // The provider's own rejection arrives after the abort and must not count against it,
    // nor may the chain move on to the next provider.
    expect(op.ids()).toEqual(['a']);
    expect(chain.status().map((s) => [s.state, s.detail, s.cooldownUntil])).toEqual([
      ['ready', undefined, undefined],
      ['ready', undefined, undefined],
    ]);
    expect(notifications).not.toHaveBeenCalled();
  });

  it('does not react to an abort that comes after the run has finished', async () => {
    const chain = new FallbackChain('mt', [provider('a')]);
    const controller = new AbortController();
    const signals: AbortSignal[] = [];

    const result = await chain.run(async (_p, signal) => {
      signals.push(signal);
      return 'done';
    }, opts({ signal: controller.signal }));
    controller.abort();
    await flushMicrotasks();

    expect(result.value).toBe('done');
    expect(chain.status()[0]).toMatchObject({ state: 'ready' });
  });
});

describe('FallbackChain: hedging', () => {
  const three = () => [provider('a'), provider('b'), provider('c')];

  it('starts the next provider only after hedgeAfterMs without an answer', async () => {
    vi.useFakeTimers();
    const chain = new FallbackChain('mt', three());
    const op = controllable();

    const pending = chain.run(op.operation, opts({ hedgeAfterMs: 100 }));
    await vi.advanceTimersByTimeAsync(99);
    expect(op.ids()).toEqual(['a']);

    await vi.advanceTimersByTimeAsync(1);
    expect(op.ids()).toEqual(['a', 'b']);
    expect(op.call('a').signal.aborted).toBe(false);

    op.call('a').result.resolve('from a');
    await expect(pending).resolves.toMatchObject({ value: 'from a', provider: { id: 'a' } });
  });

  it('does not hedge when the first provider answers in time', async () => {
    vi.useFakeTimers();
    const chain = new FallbackChain('mt', three());
    const op = controllable();

    const pending = chain.run(op.operation, opts({ hedgeAfterMs: 100 }));
    await vi.advanceTimersByTimeAsync(50);
    op.call('a').result.resolve('from a');
    await pending;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(op.ids()).toEqual(['a']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('takes the first success, aborts the loser and does not penalise it', async () => {
    vi.useFakeTimers();
    const notifications = vi.fn();
    const chain = new FallbackChain('mt', three(), { onStatusChange: notifications });
    const op = controllable();

    const pending = chain.run(op.operation, opts({ hedgeAfterMs: 100 }));
    await vi.advanceTimersByTimeAsync(100);
    op.call('b').result.resolve('from b');
    const result = await pending;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(result.value).toBe('from b');
    expect(result.provider.id).toBe('b');
    expect(result.attempts).toEqual([{ providerId: 'b', outcome: 'ok', ms: expect.any(Number) }]);
    expect(op.call('a').signal.aborted).toBe(true);
    expect(op.ids()).toEqual(['a', 'b']);
    expect(chain.status().map((s) => [s.id, s.state, s.detail])).toEqual([
      ['a', 'ready', undefined],
      ['b', 'ready', undefined],
      ['c', 'ready', undefined],
    ]);
    expect(notifications).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets the original provider win a race it was slow to start', async () => {
    vi.useFakeTimers();
    const chain = new FallbackChain('mt', three());
    const op = controllable();

    const pending = chain.run(op.operation, opts({ hedgeAfterMs: 100 }));
    await vi.advanceTimersByTimeAsync(150);
    op.call('a').result.resolve('from a');
    const result = await pending;

    expect(result.provider.id).toBe('a');
    expect(op.call('b').signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(chain.status()[1]).toMatchObject({ state: 'ready' });
    expect(chain.status()[1]?.detail).toBeUndefined();
  });

  it('does not launch a third provider when the first fails while the hedge is running', async () => {
    vi.useFakeTimers();
    const chain = new FallbackChain('mt', three());
    const op = controllable();

    const pending = chain.run(op.operation, opts({ hedgeAfterMs: 100 }));
    await vi.advanceTimersByTimeAsync(100);
    expect(op.ids()).toEqual(['a', 'b']);

    op.call('a').result.reject(new ProviderError('a', 'unavailable', 'a is down'));
    await vi.advanceTimersByTimeAsync(10);
    expect(op.ids()).toEqual(['a', 'b']);

    op.call('b').result.resolve('from b');
    const result = await pending;

    expect(result.provider.id).toBe('b');
    expect(result.attempts.map((attempt) => [attempt.providerId, attempt.outcome])).toEqual([
      ['a', 'unavailable'],
      ['b', 'ok'],
    ]);
    // The real failure of the first provider is still recorded.
    expect(chain.status()[0]).toMatchObject({ state: 'cooldown', detail: 'a is down' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(op.ids()).toEqual(['a', 'b']);
  });

  it('moves on immediately when a provider fails and nothing else is running', async () => {
    vi.useFakeTimers();
    const chain = new FallbackChain('mt', three());
    const op = controllable();

    const pending = chain.run(op.operation, opts({ hedgeAfterMs: 100 }));
    await vi.advanceTimersByTimeAsync(50);
    op.call('a').result.reject(new ProviderError('a', 'unavailable', 'a is down'));
    await vi.advanceTimersByTimeAsync(0);
    expect(op.ids()).toEqual(['a', 'b']);

    // The hedge timer now belongs to the second provider: 100 ms from ITS start, not from the first.
    await vi.advanceTimersByTimeAsync(99);
    expect(op.ids()).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(1);
    expect(op.ids()).toEqual(['a', 'b', 'c']);

    op.call('c').result.resolve('from c');
    await expect(pending).resolves.toMatchObject({ value: 'from c' });
    expect(op.call('b').signal.aborted).toBe(true);
  });

  it('fails with every attempt once all hedged providers have failed', async () => {
    vi.useFakeTimers();
    const chain = new FallbackChain('mt', [provider('a'), provider('b')]);
    const op = controllable();

    const pending = chain.run(op.operation, opts({ hedgeAfterMs: 100 }));
    const outcome = pending.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    op.call('b').result.reject(new ProviderError('b', 'rate_limit', 'b is busy'));
    await vi.advanceTimersByTimeAsync(10);
    op.call('a').result.reject(new ProviderError('a', 'rate_limit', 'a is busy'));

    const error = (await outcome) as ChainExhaustedError;
    expect(error).toBeInstanceOf(ChainExhaustedError);
    expect(error.code).toBe('rate_limited');
    expect(error.attempts.map((attempt) => attempt.providerId)).toEqual(['b', 'a']);
  });

  it('aborts every hedged request and clears its timers when the caller aborts', async () => {
    vi.useFakeTimers();
    const chain = new FallbackChain('mt', three());
    const op = controllable();
    const controller = new AbortController();

    const pending = chain.run(op.operation, opts({ signal: controller.signal, hedgeAfterMs: 100 }));
    const outcome = pending.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();

    expect(await outcome).toBeInstanceOf(AbortedError);
    expect(op.call('a').signal.aborted).toBe(true);
    expect(op.call('b').signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(op.ids()).toEqual(['a', 'b']);
    expect(vi.getTimerCount()).toBe(0);
    expect(chain.status().every((s) => s.state === 'ready' && s.detail === undefined)).toBe(true);
  });
});

describe('FallbackChain: status reporting', () => {
  it('describes every provider in configured order', async () => {
    const time = clock();
    const [a, b, c, d] = [
      provider('a', { configured: false }),
      provider('b'),
      provider('c', { requiresKey: false, label: 'Keyless C' }),
      provider('d'),
    ];
    const chain = new FallbackChain('tts', [a, b, c, d], { now: time.now });
    const { operation } = script({ b: ['auth'], c: [fail(c, 'rate_limit', { retryAfterMs: 7_000, message: 'slow down' })] });
    await chain.run(operation, opts());

    expect(chain.status()).toEqual([
      { id: 'a', kind: 'tts', label: 'Provider a', order: 0, requiresKey: true, state: 'unconfigured', detail: 'API key not set' },
      { id: 'b', kind: 'tts', label: 'Provider b', order: 1, requiresKey: true, state: 'disabled', detail: 'b auth' },
      {
        id: 'c',
        kind: 'tts',
        label: 'Keyless C',
        order: 2,
        requiresKey: false,
        state: 'cooldown',
        detail: 'slow down',
        cooldownUntil: time.now() + 7_000,
      },
      { id: 'd', kind: 'tts', label: 'Provider d', order: 3, requiresKey: true, state: 'ready', detail: undefined },
    ]);
  });

  it('shows a provider as ready again once its cooldown has passed, keeping the last error as detail', async () => {
    const time = clock();
    const chain = new FallbackChain('mt', [provider('a'), provider('b')], { now: time.now });
    await chain.run(script({ a: ['unavailable'] }).operation, opts());

    time.advance(5_000);

    expect(chain.status()[0]).toMatchObject({ state: 'ready', detail: 'a unavailable' });
    expect(chain.status()[0]?.cooldownUntil).toBeUndefined();
  });

  it('notifies on failures, on recovery and on reset, but not on ordinary successes', async () => {
    const time = clock();
    const notifications = vi.fn();
    const chain = new FallbackChain('mt', [provider('a'), provider('b')], { now: time.now, onStatusChange: notifications });
    const { operation } = script({ a: ['ok', 'unavailable', 'ok'] });

    await chain.run(operation, opts());
    expect(notifications).toHaveBeenCalledTimes(0);

    await chain.run(operation, opts()); // a fails, b answers
    expect(notifications).toHaveBeenCalledTimes(1);

    time.advance(10_000);
    await chain.run(operation, opts()); // a recovers
    expect(notifications).toHaveBeenCalledTimes(2);

    await chain.run(operation, opts());
    expect(notifications).toHaveBeenCalledTimes(2);

    chain.resetHealth();
    expect(notifications).toHaveBeenCalledTimes(3);
  });

  it('clears cooldowns, strikes and error details on resetHealth', async () => {
    const time = clock();
    const a = provider('a');
    const chain = new FallbackChain('mt', [a, provider('b')], { now: time.now });
    const { calls, operation } = script({ a: [fail(a, 'rate_limit', { retryAfterMs: 600_000 }), 'ok'] });
    await chain.run(operation, opts());

    chain.resetHealth();

    expect(chain.status()[0]).toEqual({
      id: 'a',
      kind: 'mt',
      label: 'Provider a',
      order: 0,
      requiresKey: true,
      state: 'ready',
      detail: undefined,
    });
    await chain.run(operation, opts());
    expect(calls).toEqual(['a', 'b', 'a']);
  });
});
