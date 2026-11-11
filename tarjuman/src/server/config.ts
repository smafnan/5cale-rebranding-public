import path from 'node:path';

import { z } from 'zod';

/**
 * Process configuration, read once from the environment (see `.env.example`).
 * API keys are NOT part of this object: they live in `KeyStore` so they can be
 * changed at runtime from the Settings dialog.
 */

const booleanFlag = z
  .string()
  .optional()
  .transform((value) =>
    value === undefined ? undefined : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const csvList = z
  .string()
  .optional()
  .transform((value) =>
    value === undefined
      ? undefined
      : value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
  );

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().min(1).default('127.0.0.1'),
  /** When set, the API and WebSocket require this token. Mandatory when listening beyond localhost. */
  ACCESS_TOKEN: z.string().min(8).optional(),
  /** Directory for keys saved from the UI. */
  DATA_DIR: z.string().min(1).default('data'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Log transcripts and translations (off by default: meeting content stays out of logs). */
  LOG_TRANSCRIPTS: booleanFlag,
  /** Allow saving API keys from the UI. Defaults to true only for a local, token-less server. */
  KEYS_WRITABLE: booleanFlag,
  /** Replace all providers with offline fakes (tests, demos without network). */
  TARJUMAN_MOCK: booleanFlag,
  /** Provider order overrides: comma-separated provider ids. */
  STT_PROVIDERS: csvList,
  MT_PROVIDERS: csvList,
  TTS_PROVIDERS: csvList,
  /** Directory of the built web app. */
  WEB_DIR: z.string().optional(),
  /**
   * The address users open when the server sits behind a reverse proxy, e.g.
   * https://tarjuman.example.com. Requests must then come from exactly this origin.
   */
  PUBLIC_ORIGIN: z
    .string()
    .optional()
    .transform((value, context) => {
      if (value === undefined) return undefined;
      try {
        const url = new URL(value);
        if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
      } catch {
        // fall through to the issue below
      }
      context.addIssue({ code: 'custom', message: 'must be an origin such as https://tarjuman.example.com' });
      return z.NEVER;
    }),
});

export interface AppConfig {
  port: number;
  host: string;
  accessToken: string | undefined;
  dataDir: string;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  logTranscripts: boolean;
  keysWritable: boolean;
  mock: boolean;
  providerOrder: { stt?: string[]; mt?: string[]; tts?: string[] };
  webDir: string;
  /** Origin of the reverse proxy in front of the server, when there is one. */
  publicOrigin: string | undefined;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): AppConfig {
  // An empty value means "not set": a copied .env.example is full of `NAME=` lines.
  const provided = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  const parsed = envSchema.safeParse(provided);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid configuration — ${problems}`);
  }
  const e = parsed.data;
  const local = isLoopbackHost(e.HOST);

  if (e.PUBLIC_ORIGIN && !e.ACCESS_TOKEN) {
    throw new ConfigError(
      'PUBLIC_ORIGIN means Tarjuman is reachable through a reverse proxy, which would let anyone who finds ' +
        'the address spend your API quota. Set ACCESS_TOKEN (at least 8 characters) as well.',
    );
  }
  if (!local && !e.ACCESS_TOKEN) {
    throw new ConfigError(
      `HOST=${e.HOST} makes Tarjuman reachable from other machines, which would let anyone spend your ` +
        'API quota. Set ACCESS_TOKEN (at least 8 characters) or keep HOST=127.0.0.1.',
    );
  }

  return {
    port: e.PORT,
    host: e.HOST,
    accessToken: e.ACCESS_TOKEN,
    dataDir: path.resolve(cwd, e.DATA_DIR),
    logLevel: e.LOG_LEVEL,
    logTranscripts: e.LOG_TRANSCRIPTS ?? false,
    keysWritable: e.KEYS_WRITABLE ?? (local && !e.ACCESS_TOKEN),
    mock: e.TARJUMAN_MOCK ?? false,
    providerOrder: { stt: e.STT_PROVIDERS, mt: e.MT_PROVIDERS, tts: e.TTS_PROVIDERS },
    webDir: path.resolve(cwd, e.WEB_DIR ?? 'dist/web'),
    publicOrigin: e.PUBLIC_ORIGIN,
  };
}
