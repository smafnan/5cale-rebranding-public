import type { ApiErrorBody } from '../../../shared/api';

/**
 * REST helpers. When the server was started with ACCESS_TOKEN, the token is handed to the
 * page once as `?token=...`; it is then kept for the tab's lifetime and removed from the
 * address bar so it does not end up in screenshots or the history.
 */

const TOKEN_STORAGE_KEY = 'tarjuman.token';

let cachedToken: string | null | undefined;

export function getAccessToken(): string | null {
  if (cachedToken !== undefined) return cachedToken;
  cachedToken = readToken();
  return cachedToken;
}

function readToken(): string | null {
  try {
    const url = new URL(globalThis.location.href);
    const fromUrl = url.searchParams.get('token');
    if (fromUrl) {
      globalThis.sessionStorage?.setItem(TOKEN_STORAGE_KEY, fromUrl);
      url.searchParams.delete('token');
      globalThis.history?.replaceState(null, '', url.toString());
      return fromUrl;
    }
    return globalThis.sessionStorage?.getItem(TOKEN_STORAGE_KEY) ?? null;
  } catch {
    // No usable location or storage (private mode): behave as if no token was given.
    return null;
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the Tarjuman server.');
  }
  if (response.ok) return response;

  let code = 'http_error';
  let message = `Request failed (HTTP ${response.status}).`;
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    if (body.error?.message) message = body.error.message;
    if (body.error?.code) code = body.error.code;
  } catch {
    // Not a JSON error body; keep the generic message.
  }
  throw new ApiError(response.status, code, message);
}

export async function apiGet<T>(path: string): Promise<T> {
  return (await (await request(path, { method: 'GET' })).json()) as T;
}

export async function apiSend<T>(method: 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  const response = await request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return (await response.json()) as T;
}

/** POST JSON, receive bytes (voice preview). */
export async function apiBytes(path: string, body: unknown): Promise<Uint8Array> {
  const response = await request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return new Uint8Array(await response.arrayBuffer());
}
