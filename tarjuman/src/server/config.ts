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
  .transform((value) => (value === undefined ? undefined : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())));

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
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new ConfigError(`Invalid configuration — ${problems}`);
  }
  const e = parsed.data;
  const local = isLoopbackHost(e.HOST);

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
  };
}
