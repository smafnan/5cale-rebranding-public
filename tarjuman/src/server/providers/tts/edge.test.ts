import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';

import { ProviderError } from '../types';
import {
  buildConfigMessage,
  buildSsmlMessage,
  EdgeTtsProvider,
  longVoiceName,
  parseAudioFrame,
  secMsGecV2,
} from './edge';

/** Tokens produced by the upstream Python implementation (rany2/edge-tts 7.3.1) for fixed times. */
const REFERENCE_TOKENS: [number, string][] = [
  [0, '52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6'],
  [1700000000, '2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2'],
  [1762823456.789, 'CFCCD3DBE8D0D72E-3E6ACA75458A4A1E4726586E8C09D460966C13D4DB54C4C8A09FC2F77320760E'],
  [1762823700, 'A01B87DAB289F8A1-452805089DF9D952053C282E7086D3107E670D1733C427B60D070BD6E7EE922E'],
  [1799999999.5, '8DD724B1AF1AEBDA-7EAB32704E1EBDC4C7D8109CC130E2B31826441D7C07CA6E8118FBCE8902837E'],
  [2000000001, '2D62557F1142BC5D-FD9C30C68FF194A5EE6B45FEFC5E2BA1D1239F88A90569AB55CFFFAA7799F40E'],
  [1731000299.999, 'E987698EB9C882F4-B794BE0A7E420139C6E9865CBB3FB37BD65B403BE891E15110F0D787D8458629'],
  [1731000300, '269AE1A18764E074-E314CF7AD192BFE8136A764BBA959DA2D460691CB612EEB6B5BA964BF4581A42'],
];

describe('secMsGecV2', () => {
  it.each(REFERENCE_TOKENS)('matches the reference implementation at t=%s', (seconds, token) => {
    expect(secMsGecV2(seconds)).toBe(token);
  });

  it('is constant within a five-minute window and changes at its boundary', () => {
    expect(secMsGecV2(1731000300)).toBe(secMsGecV2(1731000599));
    expect(secMsGecV2(1731000300)).not.toBe(secMsGecV2(1731000600));
  });
});

describe('message building', () => {
  it('expands short voice names the way the Edge browser sends them', () => {
    expect(longVoiceName('ur-PK-UzmaNeural')).toBe('Microsoft Server Speech Text to Speech Voice (ur-PK, UzmaNeural)');
    expect(longVoiceName('de-DE-SeraphinaMultilingualNeural')).toBe(
      'Microsoft Server Speech Text to Speech Voice (de-DE, SeraphinaMultilingualNeural)',
    );
    expect(longVoiceName('zh-CN-liaoning-XiaobeiNeural')).toBe(
      'Microsoft Server Speech Text to Speech Voice (zh-CN-liaoning, XiaobeiNeural)',
    );
    expect(longVoiceName('something else')).toBe('something else');
  });

  it('escapes text and encodes the speaking rate in the SSML request', () => {
    const message = buildSsmlMessage('Tom & Jerry <b> "x"', 'de-DE-KatjaNeural', 1.1, new Date(Date.UTC(2026, 10, 11, 9, 5, 7)));
    const [head, body] = message.split('\r\n\r\n');
    expect(head).toContain('Path:ssml');
    expect(head).toContain('Content-Type:application/ssml+xml');
    expect(head).toMatch(/X-RequestId:[0-9a-f]{32}/);
    expect(head).toContain('X-Timestamp:Wed Nov 11 2026 09:05:07 GMT+0000 (Coordinated Universal Time)Z');
    expect(body).toContain("<voice name='Microsoft Server Speech Text to Speech Voice (de-DE, KatjaNeural)'>");
    expect(body).toContain("rate='+10%'");
    expect(body).toContain('Tom &amp; Jerry &lt;b&gt; "x"');
  });

  it('asks for MP3 without word metadata in the config message', () => {
    const message = buildConfigMessage(new Date(0));
    expect(message).toContain('Path:speech.config');
    expect(message).toContain('"outputFormat":"audio-24khz-48kbitrate-mono-mp3"');
    expect(message).toContain('"wordBoundaryEnabled":"false"');
  });

  it('parses binary audio frames and rejects malformed ones', () => {
    const frame = audioFrame(Buffer.from([1, 2, 3]));
    const parsed = parseAudioFrame(frame);
    expect(parsed.headers.Path).toBe('audio');
    expect(parsed.headers['Content-Type']).toBe('audio/mpeg');
    expect([...parsed.audio]).toEqual([1, 2, 3]);
    expect(() => parseAudioFrame(Buffer.from([0]))).toThrow();
    expect(() => parseAudioFrame(Buffer.from([0xff, 0xff, 1]))).toThrow();
  });
});

// ---------------------------------------------------------------------------------------
// A local stand-in for the service, speaking the same protocol
// ---------------------------------------------------------------------------------------

function audioFrame(audio: Buffer, contentType: string | null = 'audio/mpeg'): Buffer {
  const header = Buffer.from(
    `X-RequestId:abc\r\n${contentType ? `Content-Type:${contentType}\r\n` : ''}Path:audio\r\n`,
    'utf8',
  );
  const length = Buffer.alloc(2);
  length.writeUInt16BE(header.length);
  return Buffer.concat([length, header, audio]);
}

interface FakeService {
  url: string;
  /** Upgrade requests seen, in order. */
  upgrades: IncomingMessage[];
  /** Text frames received from the client on the most recent connection. */
  received: string[];
  close(): Promise<void>;
}

type Behaviour = (socket: WebSocket, received: string[], attempt: number) => void;

/** Rejects the first `rejectFirst` upgrades with HTTP 403 (and a Date header), then behaves as given. */
async function fakeService(behaviour: Behaviour, options: { rejectFirst?: number; date?: Date } = {}): Promise<FakeService> {
  const upgrades: IncomingMessage[] = [];
  const received: string[] = [];
  let attempt = 0;
  const server = new WebSocketServer({
    host: '127.0.0.1',
    port: 0,
    verifyClient: (info, done) => {
      upgrades.push(info.req);
      if (upgrades.length <= (options.rejectFirst ?? 0)) {
        done(false, 403, 'Forbidden', { Date: (options.date ?? new Date()).toUTCString() });
      } else {
        done(true);
      }
    },
  });
  server.on('connection', (socket) => {
    received.length = 0;
    const current = attempt++;
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      received.push(data.toString());
      // The client sends the config, then the SSML; answer once both are in.
      if (received.length === 2) behaviour(socket, received, current);
    });
  });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}/consumer/speech/synthesize/readaloud/edge/v1`,
    upgrades,
    received,
    close: () =>
      new Promise((resolve) => {
        for (const client of server.clients) client.terminate();
        server.close(() => resolve());
      }),
  };
}

const speakNormally: Behaviour = (socket) => {
  socket.send('X-RequestId:abc\r\nPath:turn.start\r\n\r\n{}');
  socket.send(audioFrame(Buffer.from('first-')), { binary: true });
  socket.send('X-RequestId:abc\r\nPath:audio.metadata\r\n\r\n{"Metadata":[]}');
  socket.send(audioFrame(Buffer.from('second')), { binary: true });
  socket.send(audioFrame(Buffer.alloc(0), null), { binary: true });
  socket.send('X-RequestId:abc\r\nPath:turn.end\r\n\r\n{}');
};

function request(overrides: Partial<Parameters<EdgeTtsProvider['synthesize']>[0]> = {}) {
  return {
    text: 'Guten Morgen & willkommen',
    lang: 'de' as const,
    voice: undefined,
    rate: 1,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('EdgeTtsProvider against a local service', () => {
  let service: FakeService | undefined;
  afterEach(async () => {
    await service?.close();
    service = undefined;
  });

  it('performs the handshake, sends config and SSML, and returns the concatenated audio', async () => {
    service = await fakeService(speakNormally);
    const now = Date.UTC(2026, 10, 11, 9, 0, 0);
    const provider = new EdgeTtsProvider({ endpoint: service.url, now: () => now });

    const result = await provider.synthesize(request({ voice: 'de-DE-ConradNeural', rate: 1.2 }));

    expect(Buffer.from(result.audio).toString()).toBe('first-second');
    expect(result.mime).toBe('audio/mpeg');
    expect(result.voice).toBe('de-DE-ConradNeural');

    const upgrade = service.upgrades[0]!;
    const query = new URL(upgrade.url ?? '', 'ws://x').searchParams;
    expect(query.get('TrustedClientToken')).toBe('6A5AA1D4EAFF4E9FB37E23D68491D6F4');
    expect(query.get('ConnectionId')).toMatch(/^[0-9a-f]{32}$/);
    expect(query.get('Sec-MS-GEC')).toBe(secMsGecV2(now / 1000));
    expect(query.get('Sec-MS-GEC-Version')).toMatch(/^2-\d+\.\d+\.\d+\.\d+$/);
    expect(upgrade.headers.origin).toBe('chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold');
    expect(upgrade.headers['user-agent']).toMatch(/Edg\/\d+/);
    expect(upgrade.headers.cookie).toMatch(/^muid=[0-9A-F]{32};$/);

    expect(service.received[0]).toContain('Path:speech.config');
    expect(service.received[1]).toContain('Path:ssml');
    expect(service.received[1]).toContain('ConradNeural');
    expect(service.received[1]).toContain("rate='+20%'");
    expect(service.received[1]).toContain('Guten Morgen &amp; willkommen');
  });

  it('falls back to the default voice of the language when the requested voice does not fit', async () => {
    service = await fakeService(speakNormally);
    const provider = new EdgeTtsProvider({ endpoint: service.url });
    const result = await provider.synthesize(request({ lang: 'ur', voice: 'de-DE-KatjaNeural', text: 'سلام' }));
    expect(result.voice).toBe('ur-PK-UzmaNeural');
  });

  it('adopts the server clock and retries once when the token is rejected', async () => {
    const serverNow = new Date(Date.UTC(2026, 10, 11, 12, 0, 0));
    service = await fakeService(speakNormally, { rejectFirst: 1, date: serverNow });
    // Local clock is two hours behind the server.
    const localNow = serverNow.getTime() - 2 * 3600_000;
    const provider = new EdgeTtsProvider({ endpoint: service.url, now: () => localNow });

    const result = await provider.synthesize(request());

    expect(Buffer.from(result.audio).toString()).toBe('first-second');
    expect(service.upgrades).toHaveLength(2);
    const token = (index: number) => new URL(service!.upgrades[index]!.url ?? '', 'ws://x').searchParams.get('Sec-MS-GEC');
    expect(token(0)).toBe(secMsGecV2(localNow / 1000));
    expect(token(1)).toBe(secMsGecV2(serverNow.getTime() / 1000));
  });

  it('gives up with a classified error when the token keeps being rejected', async () => {
    service = await fakeService(speakNormally, { rejectFirst: 5 });
    const provider = new EdgeTtsProvider({ endpoint: service.url });
    const error = await provider.synthesize(request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe('bad_request');
    expect((error as ProviderError).status).toBe(403);
    expect(service.upgrades).toHaveLength(2);
  });

  it('retries once when the service drops the connection before any audio', async () => {
    service = await fakeService((socket, received, attempt) => {
      if (attempt === 0) socket.terminate();
      else speakNormally(socket, received, attempt);
    });
    const provider = new EdgeTtsProvider({ endpoint: service.url });
    const result = await provider.synthesize(request());
    expect(Buffer.from(result.audio).toString()).toBe('first-second');
    expect(service.upgrades).toHaveLength(2);
  });

  it('reports "unavailable" when the connection keeps dropping', async () => {
    service = await fakeService((socket) => socket.terminate());
    const provider = new EdgeTtsProvider({ endpoint: service.url });
    const error = await provider.synthesize(request()).catch((e: unknown) => e);
    expect((error as ProviderError).kind).toBe('unavailable');
    expect(service.upgrades).toHaveLength(2);
  });

  it('treats a turn that ends without audio as a bad response and does not retry', async () => {
    service = await fakeService((socket) => socket.send('X-RequestId:abc\r\nPath:turn.end\r\n\r\n{}'));
    const provider = new EdgeTtsProvider({ endpoint: service.url });
    const error = await provider.synthesize(request()).catch((e: unknown) => e);
    expect((error as ProviderError).kind).toBe('bad_response');
    expect(service.upgrades).toHaveLength(1);
  });

  it('stops immediately when the caller aborts', async () => {
    // The service never answers.
    service = await fakeService(() => undefined);
    const provider = new EdgeTtsProvider({ endpoint: service.url });
    const controller = new AbortController();
    const pending = provider.synthesize(request({ signal: controller.signal })).catch((e: unknown) => e);
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    const error = await pending;
    expect((error as ProviderError).kind).toBe('aborted');
    expect(service.upgrades).toHaveLength(1);
  });

  it('rejects empty text without contacting the service', async () => {
    service = await fakeService(speakNormally);
    const provider = new EdgeTtsProvider({ endpoint: service.url });
    const error = await provider.synthesize(request({ text: '   ' })).catch((e: unknown) => e);
    expect((error as ProviderError).kind).toBe('bad_request');
    expect(service.upgrades).toHaveLength(0);
  });
});
