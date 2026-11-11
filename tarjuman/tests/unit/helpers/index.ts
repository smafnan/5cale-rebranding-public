import type { MtRequest, TranslationJob } from '../../../src/server/providers/types';

/**
 * Small building blocks shared by the unit tests: controllable promises, a recording
 * `fetch` stand-in, and builders for the request objects providers receive.
 */

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Tests often reject a deferred before anything awaits it.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/** Narrow away `undefined` / `null`, failing the test with a readable message otherwise. */
export function must<T>(value: T | undefined | null, what = 'value'): T {
  if (value === undefined || value === null) throw new Error(`expected ${what} to be present`);
  return value;
}

/** Let promise continuations that are already queued run (several hops deep). */
export async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

/** Resolve on the next macrotask, after pending I/O callbacks and microtasks. */
export function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Poll until `predicate` holds. Fails instead of hanging when it never does. */
export async function waitFor(
  predicate: () => boolean,
  what = 'condition',
  timeoutMs = 4_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

export interface RecordedCall {
  url: string;
  init: RequestInit;
  headers: Headers;
  /** Request body when it was sent as a string (JSON, SSML), otherwise undefined. */
  text: string | undefined;
}

export type Responder = (call: RecordedCall, index: number) => Response | Promise<Response>;

/** A `fetch` replacement that records every call and answers from `responder`. */
export function fakeFetch(responder: Responder): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl = async (input: Parameters<typeof fetch>[0], init: RequestInit = {}): Promise<Response> => {
    const call: RecordedCall = {
      url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      init,
      headers: new Headers(init.headers),
      text: typeof init.body === 'string' ? init.body : undefined,
    };
    calls.push(call);
    return responder(call, calls.length - 1);
  };
  return { fetch: impl as typeof fetch, calls };
}

export function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

/** Parse the JSON body of a recorded call. */
export function bodyOf(call: RecordedCall): Record<string, unknown> {
  return JSON.parse(must(call.text, 'a string request body')) as Record<string, unknown>;
}

/** A sine tone as mono 16-bit PCM: loud enough to pass the server's silence gate. */
export function tonePcm(seconds: number, hz = 200, amplitude = 0.3, sampleRate = 16_000): Int16Array {
  const pcm = new Int16Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / sampleRate) * amplitude * 32767);
  }
  return pcm;
}

export function translationJob(overrides: Partial<TranslationJob> = {}): TranslationJob {
  return {
    sourceLang: 'ur',
    targetLangs: ['de', 'en'],
    formality: 'formal',
    glossary: [],
    meetingContext: '',
    history: [],
    fragment: false,
    ...overrides,
  };
}

export function mtRequest(overrides: Partial<MtRequest> = {}): MtRequest {
  return {
    ...translationJob(),
    text: 'ہم اگلے ہفتے نیا ورژن جاری کریں گے۔',
    signal: new AbortController().signal,
    ...overrides,
  };
}
