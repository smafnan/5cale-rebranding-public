import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { tonePcm, waitFor } from '../../../tests/unit/helpers';
import type { DiagnosticsReport, KeysResponse } from '../../shared/api';
import {
  decodeBinaryFrame,
  encodeBinaryFrame,
  pcm16ToBytes,
  PROTOCOL_VERSION,
  type ServerInfo,
  type ServerMessage,
  type SpeechChunkHeader,
} from '../../shared/protocol';
import { DEFAULT_SESSION_SETTINGS } from '../../shared/settings';
import { loadConfig } from '../config';
import { createServices } from '../services';
import { buildApp } from './app';

/** The real server, on a real socket, with the offline mock providers. */
interface Running {
  app: FastifyInstance;
  http: string;
  ws: string;
  dataDir: string;
}

const running: Running[] = [];
const sockets: WebSocket[] = [];

async function start(env: Record<string, string> = {}): Promise<Running> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'tarjuman-test-'));
  const fullEnv = { TARJUMAN_MOCK: '1', DATA_DIR: dataDir, ...env };
  const services = await createServices(loadConfig(fullEnv, dataDir), fullEnv);
  const app = await buildApp(services);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;
  const server = { app, http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/ws`, dataDir };
  running.push(server);
  return server;
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const server of running.splice(0)) {
    await server.app.close();
    await rm(server.dataDir, { recursive: true, force: true });
  }
});

interface Call {
  socket: WebSocket;
  messages: ServerMessage[];
  speech: SpeechChunkHeader[];
  closed: Promise<number>;
  send(message: unknown): void;
  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[];
}

async function connect(
  url: string,
  options: { headers?: Record<string, string>; start?: boolean } = {},
): Promise<Call> {
  const socket = new WebSocket(url, { headers: options.headers });
  sockets.push(socket);
  const messages: ServerMessage[] = [];
  const speech: SpeechChunkHeader[] = [];
  socket.on('message', (data, isBinary) => {
    if (isBinary) speech.push(decodeBinaryFrame(data as Buffer).header as SpeechChunkHeader);
    else messages.push(JSON.parse((data as Buffer).toString()) as ServerMessage);
  });
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  const call: Call = {
    socket,
    messages,
    speech,
    closed,
    send: (message) => socket.send(JSON.stringify(message)),
    of: (type) => messages.filter((m): m is Extract<ServerMessage, { type: typeof type }> => m.type === type),
  };
  if (options.start !== false) {
    call.send({ type: 'session.start', protocol: PROTOCOL_VERSION, settings: DEFAULT_SESSION_SETTINGS });
    await waitFor(() => call.of('session.ready').length === 1, 'session.ready');
  }
  return call;
}

describe('server over a real socket', () => {
  it('serves health and server information', async () => {
    const server = await start();
    expect(await (await fetch(`${server.http}/api/health`)).json()).toEqual({ ok: true });
    const info = (await (await fetch(`${server.http}/api/info`)).json()) as ServerInfo;
    expect(info).toMatchObject({
      name: 'tarjuman',
      protocol: PROTOCOL_VERSION,
      keysWritable: true,
      authRequired: false,
    });
    expect(info.providers.stt[0]).toMatchObject({ id: 'mock-stt', state: 'ready' });
    expect(info.voices.length).toBeGreaterThan(0);
  });

  it('interprets typed and spoken utterances end to end', async () => {
    const server = await start();
    const call = await connect(server.ws);
    expect(call.of('session.ready')[0]?.info.providers.tts[0]?.id).toBe('mock-tts');

    call.send({ type: 'utterance.text', id: 'typed1', channel: 'outgoing', text: 'یہ ایک ٹیسٹ ہے' });
    await waitFor(
      () => call.of('utterance.done').some((m) => m.id === 'typed1'),
      'typed utterance to finish',
    );

    const pcm = tonePcm(3);
    call.socket.send(
      encodeBinaryFrame(
        {
          type: 'utterance.audio',
          id: 'spoken1',
          channel: 'incoming',
          sampleRate: 16_000,
          durationMs: 3000,
          endedAt: Date.now(),
          forcedSplit: false,
          playbackLagMs: 0,
        },
        pcm16ToBytes(pcm),
      ),
    );
    await waitFor(
      () => call.of('utterance.done').some((m) => m.id === 'spoken1'),
      'spoken utterance to finish',
    );

    expect(call.of('utterance.transcript').map((m) => [m.id, m.lang])).toEqual([
      ['typed1', 'ur'],
      ['spoken1', 'de'],
    ]);
    const translation = call.of('utterance.translation').find((m) => m.id === 'spoken1');
    expect(Object.keys(translation?.translations ?? {}).sort()).toEqual(['en', 'ur']);
    expect(call.speech.map((s) => [s.id, s.lang, s.last])).toEqual([
      ['typed1', 'de', true],
      ['spoken1', 'ur', true],
    ]);
    expect(call.speech[0]?.mime).toBe('audio/wav');
  });

  it('answers pings and insists on session.start first', async () => {
    const server = await start();
    const call = await connect(server.ws, { start: false });
    call.send({ type: 'ping', t: 42 });
    call.send({ type: 'utterance.text', id: 'x', channel: 'outgoing', text: 'hello' });
    await waitFor(() => call.of('error').length === 1, 'a protocol error');
    expect(call.of('pong')[0]?.t).toBe(42);
    expect(call.of('error')[0]).toMatchObject({ code: 'protocol', fatal: false });
  });

  it('closes the connection for an incompatible protocol version', async () => {
    const server = await start();
    const call = await connect(server.ws, { start: false });
    call.send({ type: 'session.start', protocol: 999, settings: DEFAULT_SESSION_SETTINGS });
    await call.closed;
    expect(call.of('error')[0]).toMatchObject({ code: 'protocol', fatal: true });
  });

  it('survives malformed frames', async () => {
    const server = await start();
    const call = await connect(server.ws);
    call.socket.send('{not json');
    call.socket.send(Buffer.from([0, 0, 0, 9, 1, 2]));
    call.socket.send(
      encodeBinaryFrame(
        { type: 'utterance.audio', id: 'bad id!', channel: 'outgoing' } as never,
        new Uint8Array(4),
      ),
    );
    await waitFor(() => call.of('error').length === 3, 'three protocol errors');
    call.send({ type: 'ping', t: 1 });
    await waitFor(() => call.of('pong').length === 1, 'the connection to still work');
  });

  it('rejects cross-site and DNS-rebinding requests', async () => {
    const server = await start();
    const evil = await connect(server.ws, { headers: { Origin: 'https://evil.example' }, start: false });
    expect(await evil.closed).toBe(1008);
    expect(evil.of('error')[0]).toMatchObject({ code: 'unauthorized', fatal: true });

    const put = await fetch(`${server.http}/api/keys`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ keys: { GROQ_API_KEY: 'gsk_stolen' } }),
    });
    expect(put.status).toBe(403);

    // fetch() refuses to send a custom Host header, so speak HTTP directly: a page on
    // attacker.example whose DNS was re-pointed at 127.0.0.1 would arrive with this Host.
    const rebindingStatus = await new Promise<number>((resolve, reject) => {
      const url = new URL(`${server.http}/api/info`);
      httpRequest(
        {
          host: url.hostname,
          port: url.port,
          path: url.pathname,
          headers: { Host: 'attacker.example:8787' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      )
        .on('error', reject)
        .end();
    });
    expect(rebindingStatus).toBe(403);
  });

  it('requires the access token when one is configured', async () => {
    const server = await start({ ACCESS_TOKEN: 'correct-horse-battery' });
    expect((await fetch(`${server.http}/api/health`)).status).toBe(200);
    expect((await fetch(`${server.http}/api/info`)).status).toBe(401);
    expect(
      (await fetch(`${server.http}/api/info`, { headers: { authorization: 'Bearer wrong-token-value' } }))
        .status,
    ).toBe(401);
    const ok = await fetch(`${server.http}/api/info`, {
      headers: { authorization: 'Bearer correct-horse-battery' },
    });
    expect(((await ok.json()) as ServerInfo).authRequired).toBe(true);

    const refused = await connect(server.ws, { start: false });
    expect(await refused.closed).toBe(1008);
    const accepted = await connect(`${server.ws}?token=correct-horse-battery`);
    expect(accepted.of('session.ready')).toHaveLength(1);
  });

  it('saves keys to a private file, masks them, and refuses when read-only', async () => {
    const server = await start();
    const put = (keys: Record<string, unknown>, base = server.http) =>
      fetch(`${base}/api/keys`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys }),
      });

    const saved = (await (await put({ GROQ_API_KEY: 'gsk_abcdefghijklmnop' })).json()) as KeysResponse;
    const groq = saved.keys.find((key) => key.name === 'GROQ_API_KEY');
    expect(groq).toMatchObject({ set: true, source: 'file', hint: 'gsk_…mnop' });
    expect(JSON.stringify(saved)).not.toContain('gsk_abcdefghijklmnop');

    const file = path.join(server.dataDir, 'keys.json');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ GROQ_API_KEY: 'gsk_abcdefghijklmnop' });
    expect((await stat(file)).mode & 0o777).toBe(0o600);

    expect((await put({ NOT_A_KEY: 'x' })).status).toBe(400);
    expect((await put({ GROQ_API_KEY: 'has spaces in it' })).status).toBe(400);
    const removed = (await (await put({ GROQ_API_KEY: null })).json()) as KeysResponse;
    expect(removed.keys.find((key) => key.name === 'GROQ_API_KEY')?.set).toBe(false);

    const readOnly = await start({ KEYS_WRITABLE: '0' });
    expect((await put({ GROQ_API_KEY: 'gsk_abcdefghijklmnop' }, readOnly.http)).status).toBe(403);
  });

  it('previews a voice and validates the request', async () => {
    const server = await start();
    const post = (body: unknown) =>
      fetch(`${server.http}/api/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const ok = await post({ text: 'Guten Morgen', lang: 'de', voice: 'auto' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('audio/wav');
    expect(ok.headers.get('x-tarjuman-provider')).toBe('mock-tts');
    expect(ok.headers.get('x-tarjuman-voice')).toBe('mock-de');
    expect(
      Buffer.from(await ok.arrayBuffer())
        .subarray(0, 4)
        .toString(),
    ).toBe('RIFF');

    expect((await post({ text: '', lang: 'de' })).status).toBe(400);
    expect((await post({ text: 'hello', lang: 'xx' })).status).toBe(400);
    expect((await post({ text: 'x'.repeat(301), lang: 'de' })).status).toBe(400);
  });

  it('runs diagnostics against every provider', async () => {
    const server = await start();
    const report = (await (
      await fetch(`${server.http}/api/diagnostics`, { method: 'POST' })
    ).json()) as DiagnosticsReport;
    expect(report.results.map((r) => [r.kind, r.id, r.outcome])).toEqual([
      ['stt', 'mock-stt', 'ok'],
      ['mt', 'mock-mt', 'ok'],
      ['tts', 'mock-tts', 'ok'],
    ]);
  });
});
