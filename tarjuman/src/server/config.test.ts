import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'dotenv';
import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config';
import { checkRequestOrigin } from './http/security';
import { nodeSupportsEnvProxy } from './startupEnv';

describe('loadConfig', () => {
  it('has safe defaults: local only, no token, keys writable', () => {
    const config = loadConfig({}, '/app');
    expect(config).toMatchObject({
      port: 8787,
      host: '127.0.0.1',
      accessToken: undefined,
      keysWritable: true,
      mock: false,
      logTranscripts: false,
      publicOrigin: undefined,
      dataDir: path.resolve('/app', 'data'),
      webDir: path.resolve('/app', 'dist/web'),
    });
  });

  it('starts with an unmodified copy of .env.example', () => {
    const example = parse(readFileSync(path.resolve(import.meta.dirname, '../../.env.example')));
    // Every `NAME=` line of the template is an empty string, which must mean "not set".
    expect(Object.values(example).some((value) => value === '')).toBe(true);
    const config = loadConfig(example, '/app');
    expect(config.host).toBe('127.0.0.1');
    expect(config.accessToken).toBeUndefined();
  });

  it('refuses to listen beyond this machine without an access token', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0' })).toThrow(ConfigError);
    expect(() => loadConfig({ PUBLIC_ORIGIN: 'https://tarjuman.example.com' })).toThrow(/ACCESS_TOKEN/);
    const config = loadConfig({ HOST: '0.0.0.0', ACCESS_TOKEN: 'long-enough-token' });
    expect(config.keysWritable).toBe(false);
  });

  it('normalises the public origin and rejects nonsense', () => {
    const config = loadConfig({
      PUBLIC_ORIGIN: 'https://Tarjuman.Example.com/app/',
      ACCESS_TOKEN: 'long-enough-token',
    });
    expect(config.publicOrigin).toBe('https://tarjuman.example.com');
    expect(() =>
      loadConfig({ PUBLIC_ORIGIN: 'tarjuman.example.com', ACCESS_TOKEN: 'long-enough-token' }),
    ).toThrow(ConfigError);
  });

  it('reads flags and provider lists', () => {
    const config = loadConfig({
      TARJUMAN_MOCK: 'true',
      LOG_TRANSCRIPTS: '1',
      KEYS_WRITABLE: '0',
      MT_PROVIDERS: ' custom , mymemory ,',
    });
    expect(config).toMatchObject({ mock: true, logTranscripts: true, keysWritable: false });
    expect(config.providerOrder.mt).toEqual(['custom', 'mymemory']);
    expect(config.providerOrder.stt).toBeUndefined();
  });

  it('explains what is wrong with a bad value', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => loadConfig({ ACCESS_TOKEN: 'short' })).toThrow(/ACCESS_TOKEN/);
  });
});

describe('checkRequestOrigin', () => {
  const local = { listenHost: '127.0.0.1' };

  it('accepts same-origin and non-browser requests on a local server', () => {
    expect(
      checkRequestOrigin({ ...local, hostHeader: 'localhost:8787', originHeader: 'http://localhost:8787' }),
    ).toBeNull();
    expect(
      checkRequestOrigin({ ...local, hostHeader: '127.0.0.1:8787', originHeader: undefined }),
    ).toBeNull();
    expect(
      checkRequestOrigin({ ...local, hostHeader: '[::1]:8787', originHeader: 'http://[::1]:8787' }),
    ).toBeNull();
  });

  it('rejects other sites and rebound host names', () => {
    expect(
      checkRequestOrigin({ ...local, hostHeader: 'localhost:8787', originHeader: 'https://evil.example' }),
    ).toMatch(/cross-origin/);
    expect(
      checkRequestOrigin({ ...local, hostHeader: 'localhost:8787', originHeader: 'null' }),
    ).not.toBeNull();
    expect(
      checkRequestOrigin({ ...local, hostHeader: 'evil.example:8787', originHeader: undefined }),
    ).toMatch(/unexpected Host/);
    expect(
      checkRequestOrigin({ ...local, hostHeader: 'localhost.evil.example', originHeader: undefined }),
    ).toMatch(/unexpected Host/);
    expect(checkRequestOrigin({ ...local, hostHeader: undefined, originHeader: undefined })).toMatch(
      /missing Host/,
    );
  });

  it('behind a reverse proxy, trusts exactly the configured public origin whatever Host the proxy sends', () => {
    const proxied = { listenHost: '0.0.0.0', publicOrigin: 'https://tarjuman.example.com' };
    expect(
      checkRequestOrigin({
        ...proxied,
        hostHeader: 'tarjuman:8787',
        originHeader: 'https://tarjuman.example.com',
      }),
    ).toBeNull();
    expect(
      checkRequestOrigin({
        ...proxied,
        hostHeader: '127.0.0.1:8787',
        originHeader: 'https://TARJUMAN.example.com',
      }),
    ).toBeNull();
    expect(
      checkRequestOrigin({ ...proxied, hostHeader: 'tarjuman:8787', originHeader: 'https://evil.example' }),
    ).toMatch(/cross-origin/);
    expect(
      checkRequestOrigin({ ...proxied, hostHeader: 'tarjuman:8787', originHeader: undefined }),
    ).toBeNull();
  });
});

describe('nodeSupportsEnvProxy', () => {
  it('knows from which Node version the proxy flag exists', () => {
    expect(nodeSupportsEnvProxy('22.12.0')).toBe(false);
    expect(nodeSupportsEnvProxy('22.21.0')).toBe(true);
    expect(nodeSupportsEnvProxy('24.1.0')).toBe(true);
  });
});
