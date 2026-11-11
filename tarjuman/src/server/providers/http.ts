import { ProviderError, type ProviderErrorKind } from './types';

/**
 * One place that turns HTTP outcomes into `ProviderError`s, so every provider
 * classifies failures the same way and the fallback chain can react correctly.
 */

export interface HttpRequestOptions {
  providerId: string;
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: RequestInit['body'];
  signal: AbortSignal;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

const BODY_SNIPPET_CHARS = 300;

const INVALID_KEY_PATTERN = /API_KEY_INVALID|API key not valid|API key expired|invalid api key/i;

function classifyStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'unavailable';
  return 'bad_request';
}

/**
 * How long the provider asked us to wait, in ms.
 * Understands `Retry-After-Ms`, `Retry-After` (seconds or HTTP date) and the
 * `"retryDelay": "34s"` hint that Google APIs put in the error body.
 */
export function parseRetryAfter(
  headers: Headers,
  body: string,
  now: number = Date.now(),
): number | undefined {
  // Groq additionally sends the wait in milliseconds; prefer the more precise value.
  const millis = Number(headers.get('retry-after-ms')?.trim() || Number.NaN);
  if (Number.isFinite(millis) && millis >= 0) return Math.ceil(millis);

  const header = headers.get('retry-after')?.trim();
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
      if (seconds >= 0) return Math.ceil(seconds * 1000);
      // A negative number is nonsense; do not let Date.parse read it as a year.
    } else {
      const date = Date.parse(header);
      if (Number.isFinite(date)) return Math.max(0, date - now);
    }
  }
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  if (match?.[1]) return Math.ceil(Number(match[1]) * 1000);
  return undefined;
}

/** Pull a human-readable message out of the usual JSON error envelopes. */
export function extractErrorMessage(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  try {
    const json: unknown = JSON.parse(trimmed);
    if (json && typeof json === 'object') {
      const error = (json as { error?: unknown }).error;
      if (typeof error === 'string') return error;
      if (error && typeof error === 'object') {
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string') return message;
      }
      const message = (json as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return trimmed.replace(/\s+/g, ' ');
}

/**
 * Perform a request and return the response if (and only if) it is 2xx.
 * Everything else becomes a classified `ProviderError`.
 */
export async function httpRequest(options: HttpRequestOptions): Promise<Response> {
  const { providerId, url, signal } = options;
  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(url, {
      method: options.method ?? 'POST',
      headers: options.headers,
      body: options.body,
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw new ProviderError(providerId, 'aborted', 'request aborted', { cause: error });
    const reason =
      error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : '';
    throw new ProviderError(providerId, 'unavailable', `network error${reason ? `: ${reason}` : ''}`, {
      cause: error,
    });
  }

  if (response.ok) return response;

  const body = await response.text().catch(() => '');
  let kind = classifyStatus(response.status);
  // Google answers an invalid key with HTTP 400 (reason API_KEY_INVALID), not 401. It must
  // not be mistaken for a malformed request, which callers react to by changing the request.
  if (kind === 'bad_request' && INVALID_KEY_PATTERN.test(body)) kind = 'auth';
  const detail = extractErrorMessage(body).slice(0, BODY_SNIPPET_CHARS);
  throw new ProviderError(providerId, kind, `HTTP ${response.status}${detail ? ` — ${detail}` : ''}`, {
    status: response.status,
    retryAfterMs: kind === 'rate_limit' ? parseRetryAfter(response.headers, body) : undefined,
  });
}

export async function readJson<T>(providerId: string, response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new ProviderError(providerId, 'bad_response', 'response was not valid JSON', { cause: error });
  }
}
