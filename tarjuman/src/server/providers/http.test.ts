import { describe, expect, it } from 'vitest';

import { fakeFetch, jsonResponse } from '../../../tests/unit/helpers';
import { extractErrorMessage, httpRequest, parseRetryAfter, readJson } from './http';
import { ProviderError } from './types';

const signal = () => new AbortController().signal;

async function failure(run: Promise<unknown>): Promise<ProviderError> {
  const error = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

describe('httpRequest', () => {
  it('returns the response for a 2xx answer and passes the request through', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse({ fine: true }, { status: 201 }));
    const abort = new AbortController();

    const response = await httpRequest({
      providerId: 'p',
      url: 'https://api.example.test/v1/thing',
      headers: { 'x-test': 'yes' },
      body: '{"a":1}',
      signal: abort.signal,
      fetchImpl: fetch,
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ fine: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.example.test/v1/thing');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.signal).toBe(abort.signal);
    expect(calls[0]?.headers.get('x-test')).toBe('yes');
    expect(calls[0]?.text).toBe('{"a":1}');
  });

  it('uses the requested method', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse({}));
    await httpRequest({ providerId: 'p', url: 'https://x.test', method: 'GET', signal: signal(), fetchImpl: fetch });
    expect(calls[0]?.init.method).toBe('GET');
  });

  it.each([
    [400, 'bad_request'],
    [404, 'bad_request'],
    [413, 'bad_request'],
    [422, 'bad_request'],
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [408, 'timeout'],
    [504, 'timeout'],
    [500, 'unavailable'],
    [502, 'unavailable'],
    [503, 'unavailable'],
    [529, 'unavailable'],
  ] as const)('classifies HTTP %i as %s', async (status, kind) => {
    const { fetch } = fakeFetch(() => jsonResponse({ error: { message: 'nope' } }, { status }));

    const error = await failure(httpRequest({ providerId: 'prov', url: 'https://x.test', signal: signal(), fetchImpl: fetch }));

    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.providerId).toBe('prov');
    expect(error.message).toBe(`HTTP ${status} — nope`);
  });

  it('reads Retry-After in seconds on a 429', async () => {
    const { fetch } = fakeFetch(() => jsonResponse({}, { status: 429, headers: { 'retry-after': '7' } }));
    const error = await failure(httpRequest({ providerId: 'p', url: 'https://x.test', signal: signal(), fetchImpl: fetch }));
    expect(error.retryAfterMs).toBe(7_000);
  });

  it('reads the Google "retryDelay" hint from the body of a 429', async () => {
    const body = {
      error: {
        code: 429,
        message: 'Quota exceeded for metric generate_content_free_tier_requests',
        status: 'RESOURCE_EXHAUSTED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '34s' }],
      },
    };
    const { fetch } = fakeFetch(() => jsonResponse(body, { status: 429 }));

    const error = await failure(httpRequest({ providerId: 'p', url: 'https://x.test', signal: signal(), fetchImpl: fetch }));

    expect(error.kind).toBe('rate_limit');
    expect(error.retryAfterMs).toBe(34_000);
    expect(error.message).toContain('Quota exceeded');
  });

  it('leaves retryAfterMs unset when a 429 carries no hint', async () => {
    const { fetch } = fakeFetch(() => jsonResponse({}, { status: 429 }));
    const error = await failure(httpRequest({ providerId: 'p', url: 'https://x.test', signal: signal(), fetchImpl: fetch }));
    expect(error.retryAfterMs).toBeUndefined();
  });

  it('only reports a retry hint for rate limiting', async () => {
    const { fetch } = fakeFetch(() => jsonResponse({}, { status: 503, headers: { 'retry-after': '120' } }));
    const error = await failure(httpRequest({ providerId: 'p', url: 'https://x.test', signal: signal(), fetchImpl: fetch }));
    expect(error.kind).toBe('unavailable');
    expect(error.retryAfterMs).toBeUndefined();
  });

  it('keeps the error message short when the body is huge', async () => {
    const { fetch } = fakeFetch(() => new Response('x'.repeat(10_000), { status: 500 }));
    const error = await failure(httpRequest({ providerId: 'p', url: 'https://x.test', signal: signal(), fetchImpl: fetch }));
    expect(error.message).toBe(`HTTP 500 — ${'x'.repeat(300)}`);
  });

  it('reports the bare status when the body is empty', async () => {
    const { fetch } = fakeFetch(() => new Response('', { status: 502 }));
    const error = await failure(httpRequest({ providerId: 'p', url: 'https://x.test', signal: signal(), fetchImpl: fetch }));
    expect(error.message).toBe('HTTP 502');
  });

  it('turns a transport failure into "unavailable", naming the underlying cause', async () => {
    const cause = new Error('connect ECONNREFUSED 127.0.0.1:9');
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed', { cause });
    }) as unknown as typeof fetch;

    const error = await failure(httpRequest({ providerId: 'p', url: 'https://x.test', signal: signal(), fetchImpl }));

    expect(error.kind).toBe('unavailable');
    expect(error.status).toBeUndefined();
    expect(error.message).toBe('network error: connect ECONNREFUSED 127.0.0.1:9');
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  it('falls back to the error message when a transport failure has no cause', async () => {
    const fetchImpl = (async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;
    const error = await failure(httpRequest({ providerId: 'p', url: 'https://x.test', signal: signal(), fetchImpl }));
    expect(error.message).toBe('network error: socket hang up');
  });

  it('reports "aborted" when the caller aborts while the request is in flight', async () => {
    const abort = new AbortController();
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
      })) as unknown as typeof fetch;

    const pending = failure(httpRequest({ providerId: 'p', url: 'https://x.test', signal: abort.signal, fetchImpl }));
    abort.abort();
    const error = await pending;

    expect(error.kind).toBe('aborted');
  });

  it('reaches a real server through the global fetch when no fetchImpl is given', async () => {
    const { createServer } = await import('node:http');
    const server = createServer((request, response) => {
      response.writeHead(request.url === '/ok' ? 200 : 418, { 'content-type': 'application/json' });
      response.end(JSON.stringify(request.url === '/ok' ? { method: request.method } : { message: 'teapot' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
      const ok = await httpRequest({ providerId: 'p', url: `http://127.0.0.1:${port}/ok`, method: 'GET', signal: signal() });
      expect(await ok.json()).toEqual({ method: 'GET' });

      const error = await failure(httpRequest({ providerId: 'p', url: `http://127.0.0.1:${port}/no`, signal: signal() }));
      expect(error).toMatchObject({ kind: 'bad_request', status: 418, message: 'HTTP 418 — teapot' });
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('reports a refused connection as "unavailable"', async () => {
    const { createServer } = await import('node:net');
    // Reserve a port, then close it again so that nothing listens there.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address() as { port: number };
    await new Promise((resolve) => probe.close(resolve));

    const error = await failure(httpRequest({ providerId: 'p', url: `http://127.0.0.1:${port}/`, signal: signal() }));

    expect(error.kind).toBe('unavailable');
    expect(error.message).toMatch(/^network error/);
  });
});

describe('parseRetryAfter', () => {
  const NOW = Date.parse('2026-11-11T10:00:00Z');
  const headers = (value?: string) => new Headers(value === undefined ? {} : { 'retry-after': value });

  it('reads whole and fractional seconds', () => {
    expect(parseRetryAfter(headers('30'), '', NOW)).toBe(30_000);
    expect(parseRetryAfter(headers('0'), '', NOW)).toBe(0);
    expect(parseRetryAfter(headers('1.5'), '', NOW)).toBe(1_500);
    expect(parseRetryAfter(headers('0.0004'), '', NOW)).toBe(1);
  });

  it('reads an HTTP date relative to now', () => {
    expect(parseRetryAfter(headers('Wed, 11 Nov 2026 10:00:42 GMT'), '', NOW)).toBe(42_000);
  });

  it('never returns a negative wait for a date in the past', () => {
    expect(parseRetryAfter(headers('Wed, 11 Nov 2026 09:59:00 GMT'), '', NOW)).toBe(0);
  });

  it('reads the retryDelay hint from a Google error body', () => {
    expect(parseRetryAfter(headers(), '{"details":[{"retryDelay":"34s"}]}', NOW)).toBe(34_000);
    expect(parseRetryAfter(headers(), '{ "retryDelay" : "1.2s" }', NOW)).toBe(1_200);
    expect(parseRetryAfter(headers(), '"retryDelay": "0.0001s"', NOW)).toBe(1);
  });

  it('prefers the header over the body', () => {
    expect(parseRetryAfter(headers('5'), '{"retryDelay":"34s"}', NOW)).toBe(5_000);
  });

  it('falls back to the body when the header is unusable', () => {
    expect(parseRetryAfter(headers('soon'), '{"retryDelay":"9s"}', NOW)).toBe(9_000);
    expect(parseRetryAfter(headers('-5'), '{"retryDelay":"9s"}', NOW)).toBe(9_000);
  });

  it('returns undefined when there is no hint', () => {
    expect(parseRetryAfter(headers(), '', NOW)).toBeUndefined();
    expect(parseRetryAfter(headers(), '{"error":"rate limited"}', NOW)).toBeUndefined();
    expect(parseRetryAfter(headers('soon'), 'retryDelay later', NOW)).toBeUndefined();
  });
});

describe('extractErrorMessage', () => {
  it('reads the OpenAI / Google envelope', () => {
    expect(extractErrorMessage('{"error":{"message":"Invalid API Key","type":"invalid_request_error"}}')).toBe(
      'Invalid API Key',
    );
  });

  it('reads a string error', () => {
    expect(extractErrorMessage('{"error":"model not found"}')).toBe('model not found');
  });

  it('reads a top-level message', () => {
    expect(extractErrorMessage('{"message":"Resource not found","statusCode":404}')).toBe('Resource not found');
  });

  it('prefers the nested error message over a top-level one', () => {
    expect(extractErrorMessage('{"message":"outer","error":{"message":"inner"}}')).toBe('inner');
  });

  it('falls back to the raw text, with whitespace collapsed', () => {
    expect(extractErrorMessage('  <html>\n  <body>Bad   Gateway</body>\n</html>  ')).toBe(
      '<html> <body>Bad Gateway</body> </html>',
    );
  });

  it('falls back to the raw JSON when no known field is present', () => {
    expect(extractErrorMessage('{"code": 7,\n "status": "DENIED"}')).toBe('{"code": 7, "status": "DENIED"}');
    expect(extractErrorMessage('{"error":{"code":7}}')).toBe('{"error":{"code":7}}');
    expect(extractErrorMessage('[1, 2]')).toBe('[1, 2]');
    expect(extractErrorMessage('null')).toBe('null');
  });

  it('returns an empty string for an empty body', () => {
    expect(extractErrorMessage('')).toBe('');
    expect(extractErrorMessage(' \n\t ')).toBe('');
  });
});

describe('readJson', () => {
  it('parses a JSON body', async () => {
    expect(await readJson<{ a: number }>('p', jsonResponse({ a: 1 }))).toEqual({ a: 1 });
  });

  it('reports a non-JSON body as an unusable answer', async () => {
    const error = await failure(readJson('prov', new Response('<html>oops</html>')));
    expect(error).toMatchObject({ kind: 'bad_response', providerId: 'prov', message: 'response was not valid JSON' });
  });
});
