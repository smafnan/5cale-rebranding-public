import { timingSafeEqual } from 'node:crypto';

import { isLoopbackHost } from '../config';

/**
 * Request-origin checks shared by the REST routes and the WebSocket upgrade.
 *
 * A server on 127.0.0.1 is reachable by every web page the user visits, so "it only
 * listens locally" is not a security boundary by itself. These checks close the two
 * classic holes: cross-site requests (a foreign page calling our API with the user's
 * browser) and DNS rebinding (a foreign hostname resolving to 127.0.0.1).
 */

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Extract `host` (without port) from a Host header or URL authority. */
export function hostnameOf(authority: string): string {
  const trimmed = authority.trim().toLowerCase();
  if (trimmed.startsWith('[')) return trimmed.slice(0, trimmed.indexOf(']') + 1);
  const colon = trimmed.lastIndexOf(':');
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface OriginCheckInput {
  /** The address the server listens on. */
  listenHost: string;
  hostHeader: string | undefined;
  originHeader: string | undefined;
}

/**
 * Returns null when the request is acceptable, or a reason for rejecting it.
 *
 * - When listening on loopback, the Host header must be a loopback name (anti DNS rebinding).
 * - When the browser sends an Origin, it must be the same origin as the Host (anti cross-site).
 *   Non-browser clients send no Origin and are not affected.
 */
export function checkRequestOrigin(input: OriginCheckInput): string | null {
  const host = input.hostHeader?.trim().toLowerCase();
  if (!host) return 'missing Host header';
  if (isLoopbackHost(input.listenHost) && !LOOPBACK_NAMES.has(hostnameOf(host))) {
    return `unexpected Host "${host}"`;
  }
  if (input.originHeader) {
    let origin: URL;
    try {
      origin = new URL(input.originHeader);
    } catch {
      return 'malformed Origin header';
    }
    if (origin.host.toLowerCase() !== host) return `cross-origin request from ${origin.origin}`;
  }
  return null;
}

/** Bearer token from an Authorization header, or undefined. */
export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return match?.[1]?.trim();
}
