import { createHash, randomBytes, randomUUID } from 'node:crypto';

import WebSocket from 'ws';

import { LANG_CODES, type LangCode } from '../../../shared/languages';
import type { VoiceInfo } from '../../../shared/protocol';
import { ProviderError, type TtsProvider, type TtsRequest, type TtsResult } from '../types';
import { escapeSsmlText, NEURAL_VOICES, resolveVoice, ssmlRate } from './voices';

/**
 * Microsoft Edge "Read aloud" neural voices over the WebSocket endpoint that the Edge
 * browser itself uses. No key, no sign-up, and the only free source of natural-sounding
 * Urdu (ur-PK) speech.
 *
 * This is NOT an official public API. It can change or be withdrawn without notice and
 * Microsoft's terms do not grant third-party use; it is here because a proof of concept
 * needs a zero-cost voice. For anything beyond a PoC, set AZURE_SPEECH_KEY: the Azure
 * provider serves the same voices through the official, supported API.
 *
 * Protocol ported from the reference implementation rany2/edge-tts 7.3.1; the token
 * algorithm is verified against that implementation's output in edge.test.ts.
 */

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0];
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;
const DEFAULT_ENDPOINT = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
/** The service rejects SSML text above this many bytes. */
const MAX_TEXT_BYTES = 4_096;
const HANDSHAKE_TIMEOUT_MS = 6_000;

const WIN_EPOCH_SECONDS = 11_644_473_600;
/** The v2 token hashes this fixed prefix followed by the time ticks and the client token. */
const TOKEN_PREFIX = Buffer.from('Copyright (C) Microsoft Corporation. All rights reserved.', 'ascii');

const rol16 = (value: number): number => ((value << 16) | (value >>> 16)) >>> 0;
const mul = Math.imul;

/** 64-bit checksum that forms the first half of the v2 token. */
function cs64(message: Buffer, sha: Buffer): Buffer {
  const keyA = (sha.readUInt32LE(0) | 1) >>> 0;
  const keyB = (sha.readUInt32LE(4) | 1) >>> 0;
  const padded = Buffer.alloc(Math.ceil(message.length / 8) * 8);
  message.copy(padded);

  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let offset = 0; offset < padded.length; offset += 8) {
    const w0 = padded.readUInt32LE(offset);
    const w1 = padded.readUInt32LE(offset + 4);

    let q = mul(rol16((mul(w0, keyA) + mul(rol16(w0), 0xef0569fb)) >>> 0), 0x76f50f34) >>> 0;
    const swap0 = (mul(rol16(q), 0xc3efea97) + q) >>> 0;
    q = mul(rol16((mul(w1, keyB) + mul(rol16(w1), 0xc31713db)) >>> 0), 0x1881ce3c) >>> 0;
    swapLast = (mul(rol16(q), 0x35bd1ec9) + q) >>> 0;
    swapAcc = (swapAcc + swap0 + swapLast) >>> 0;

    state = mul((state + w0) >>> 0, keyA) >>> 0;
    for (const k of [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83]) state = mul(rol16(state), k) >>> 0;
    acc = (acc + state) >>> 0;
    state = mul((state + w1) >>> 0, keyB) >>> 0;
    for (const k of [0xa27416f5, 0xd38396ff, 0x7c932b89, 0xbfa49f69]) state = mul(rol16(state), k) >>> 0;
    acc = (acc + state) >>> 0;
  }

  const out = Buffer.alloc(8);
  out.writeUInt32LE((swapLast ^ state) >>> 0, 0);
  out.writeUInt32LE((swapAcc ^ acc) >>> 0, 4);
  return out;
}

/**
 * The `Sec-MS-GEC` request token ("v2" scheme): derived from the current time rounded
 * down to 5 minutes, so it only works when the local clock is roughly right.
 */
export function secMsGecV2(unixSeconds: number): string {
  let ticks = unixSeconds + WIN_EPOCH_SECONDS;
  ticks -= ticks % 300;
  ticks *= 1e7; // 100-nanosecond intervals
  const message = Buffer.concat([
    TOKEN_PREFIX,
    Buffer.from(`${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`, 'ascii'),
  ]);
  const sha = createHash('sha256').update(message).digest();
  return `${cs64(message, sha).toString('hex').toUpperCase()}-${sha.toString('hex').toUpperCase()}`;
}

/** "ur-PK-UzmaNeural" -> "Microsoft Server Speech Text to Speech Voice (ur-PK, UzmaNeural)". */
export function longVoiceName(shortName: string): string {
  const match = /^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/.exec(shortName);
  if (!match) return shortName;
  const [, lang, region, name] = match as unknown as [string, string, string, string];
  const dash = name.indexOf('-');
  // Names such as "zh-CN-liaoning-XiaobeiNeural" carry a sub-region before the voice name.
  return dash === -1
    ? `Microsoft Server Speech Text to Speech Voice (${lang}-${region}, ${name})`
    : `Microsoft Server Speech Text to Speech Voice (${lang}-${region}-${name.slice(0, dash)}, ${name.slice(dash + 1)})`;
}

/** Date in the format Edge's JavaScript produces. */
function edgeTimestamp(now: Date): string {
  const [weekday, day, month, year, time] = now.toUTCString().replace(',', '').split(' ');
  return `${weekday} ${month} ${day} ${year} ${time} GMT+0000 (Coordinated Universal Time)`;
}

export function buildConfigMessage(now: Date): string {
  return (
    `X-Timestamp:${edgeTimestamp(now)}\r\n` +
    'Content-Type:application/json; charset=utf-8\r\n' +
    'Path:speech.config\r\n\r\n' +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
    '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},' +
    `"outputFormat":"${OUTPUT_FORMAT}"}}}}\r\n`
  );
}

export function buildSsmlMessage(text: string, voiceId: string, rate: number, now: Date): string {
  const ssml =
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${longVoiceName(voiceId)}'>` +
    `<prosody pitch='+0Hz' rate='${ssmlRate(rate)}' volume='+0%'>${escapeSsmlText(text)}</prosody>` +
    '</voice></speak>';
  return (
    `X-RequestId:${randomUUID().replaceAll('-', '')}\r\n` +
    'Content-Type:application/ssml+xml\r\n' +
    // The trailing "Z" after the timezone text is what Edge itself sends.
    `X-Timestamp:${edgeTimestamp(now)}Z\r\n` +
    'Path:ssml\r\n\r\n' +
    ssml
  );
}

/** Binary frame: [uint16 BE header length][headers, CRLF separated][audio bytes]. */
export function parseAudioFrame(frame: Buffer): { headers: Record<string, string>; audio: Buffer } {
  if (frame.length < 2) throw new Error('binary frame is missing its header length');
  const headerLength = frame.readUInt16BE(0);
  if (2 + headerLength > frame.length) throw new Error('binary frame header is longer than the frame');
  const headers: Record<string, string> = {};
  for (const line of frame
    .subarray(2, 2 + headerLength)
    .toString('utf8')
    .split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon)] = line.slice(colon + 1);
  }
  return { headers, audio: frame.subarray(2 + headerLength) };
}

function textFramePath(message: string): string | undefined {
  const end = message.indexOf('\r\n\r\n');
  const head = end === -1 ? message : message.slice(0, end);
  return /^Path:(.*)$/m.exec(head)?.[1]?.trim();
}

/** Cut text so its SSML-escaped form stays within the service limit, never inside a character. */
function limitTextBytes(text: string): string {
  let out = text;
  while (Buffer.byteLength(escapeSsmlText(out), 'utf8') > MAX_TEXT_BYTES) {
    out = out.slice(0, Math.floor(out.length * 0.9));
  }
  return out;
}

export interface EdgeTtsOptions {
  /** Override the endpoint (tests point this at a local fake). */
  endpoint?: string;
  now?: () => number;
}

class HandshakeRejected extends Error {
  constructor(
    readonly status: number,
    readonly serverDate: number | undefined,
  ) {
    super(`handshake rejected with HTTP ${status}`);
  }
}

export class EdgeTtsProvider implements TtsProvider {
  readonly id = 'edge';
  readonly kind = 'tts' as const;
  readonly label = 'Microsoft Edge neural voices (no key)';
  readonly requiresKey = false;
  readonly timeoutMs = 12_000;
  private readonly endpoint: string;
  private readonly now: () => number;
  /** Correction learned from the server's clock when a token is rejected. */
  private clockSkewMs = 0;

  constructor(options: EdgeTtsOptions = {}) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.now = options.now ?? Date.now;
  }

  isConfigured(): boolean {
    return true;
  }

  supportsLanguage(lang: LangCode): boolean {
    return (LANG_CODES as readonly string[]).includes(lang);
  }

  voices(): VoiceInfo[] {
    return NEURAL_VOICES.map((v) => ({
      id: v.id,
      provider: this.id,
      lang: v.lang,
      locale: v.locale,
      label: v.name,
      gender: v.gender,
    }));
  }

  async synthesize(request: TtsRequest): Promise<TtsResult> {
    const voice = resolveVoice(request.lang, request.voice);
    const text = limitTextBytes(request.text.trim());
    if (!text) throw new ProviderError(this.id, 'bad_request', 'nothing to synthesize');

    try {
      return await this.attempt(text, voice.id, request);
    } catch (error) {
      if (request.signal.aborted || !this.worthRetrying(error)) throw this.classify(error, request.signal);
      if (error instanceof HandshakeRejected && error.serverDate !== undefined) {
        // The token is time-based: a wrong local clock is the usual cause of a 403.
        // Adopt the server's clock for this and all later requests.
        this.clockSkewMs = error.serverDate - this.now();
      }
      try {
        return await this.attempt(text, voice.id, request);
      } catch (retryError) {
        throw this.classify(retryError, request.signal);
      }
    }
  }

  /**
   * One immediate second attempt is worthwhile for a rejected token (after correcting the
   * clock) and for the service's sporadic habit of dropping the connection before any audio
   * arrives. Everything else (bad request, rate limit) would fail the same way again.
   */
  private worthRetrying(error: unknown): boolean {
    if (error instanceof ProviderError) return false;
    if (error instanceof HandshakeRejected) return error.status === 403 && error.serverDate !== undefined;
    return true;
  }

  private classify(error: unknown, signal: AbortSignal): ProviderError {
    if (error instanceof ProviderError) return error;
    if (signal.aborted) return new ProviderError(this.id, 'aborted', 'request aborted', { cause: error });
    if (error instanceof HandshakeRejected) {
      if (error.status === 429)
        return new ProviderError(this.id, 'rate_limit', error.message, { status: 429 });
      // 403 after the clock-skew retry means the token scheme or client version was rejected.
      const kind = error.status >= 500 ? 'unavailable' : 'bad_request';
      return new ProviderError(this.id, kind, `Edge voice service: ${error.message}`, {
        status: error.status,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    return new ProviderError(this.id, 'unavailable', `Edge voice service: ${message}`, { cause: error });
  }

  private connectionUrl(): string {
    const token = secMsGecV2((this.now() + this.clockSkewMs) / 1000);
    const params = new URLSearchParams({
      TrustedClientToken: TRUSTED_CLIENT_TOKEN,
      ConnectionId: randomUUID().replaceAll('-', ''),
      'Sec-MS-GEC': token,
      'Sec-MS-GEC-Version': SEC_MS_GEC_VERSION,
    });
    return `${this.endpoint}?${params.toString()}`;
  }

  private attempt(text: string, voiceId: string, request: TtsRequest): Promise<TtsResult> {
    return new Promise<TtsResult>((resolve, reject) => {
      const socket = new WebSocket(this.connectionUrl(), {
        handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
        headers: {
          Pragma: 'no-cache',
          'Cache-Control': 'no-cache',
          Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
            `Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Accept-Language': 'en-US,en;q=0.9',
          Cookie: `muid=${randomBytes(16).toString('hex').toUpperCase()};`,
        },
      });

      const chunks: Buffer[] = [];
      let settled = false;

      const finish = (outcome: () => void) => {
        if (settled) return;
        settled = true;
        request.signal.removeEventListener('abort', onAbort);
        // terminate() is safe in every state; close() can throw before the socket is open.
        socket.terminate();
        outcome();
      };
      const fail = (error: unknown) =>
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      const onAbort = () => fail(new ProviderError(this.id, 'aborted', 'request aborted'));

      if (request.signal.aborted) return onAbort();
      request.signal.addEventListener('abort', onAbort, { once: true });

      socket.on('unexpected-response', (_req, response) => {
        const date = Date.parse(response.headers.date ?? '');
        response.resume();
        fail(new HandshakeRejected(response.statusCode ?? 0, Number.isFinite(date) ? date : undefined));
      });

      socket.on('open', () => {
        const now = new Date(this.now());
        socket.send(buildConfigMessage(now));
        socket.send(buildSsmlMessage(text, voiceId, request.rate, now));
      });

      socket.on('message', (data, isBinary) => {
        try {
          const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
          if (isBinary) {
            const { headers, audio } = parseAudioFrame(buffer);
            if (headers.Path !== 'audio') throw new Error(`unexpected binary frame path "${headers.Path}"`);
            // Frames without a Content-Type are empty keep-alives at the end of the stream.
            if (audio.length > 0 && headers['Content-Type'] === 'audio/mpeg') chunks.push(audio);
            return;
          }
          const path = textFramePath(buffer.toString('utf8'));
          if (path !== 'turn.end') return; // turn.start, response, audio.metadata
          if (chunks.length === 0) {
            throw new ProviderError(this.id, 'bad_response', 'Edge voice service returned no audio');
          }
          finish(() =>
            resolve({ audio: new Uint8Array(Buffer.concat(chunks)), mime: 'audio/mpeg', voice: voiceId }),
          );
        } catch (error) {
          fail(error);
        }
      });

      socket.on('error', fail);
      socket.on('close', (code) =>
        fail(new Error(`connection closed before the audio was complete (code ${code})`)),
      );
    });
  }
}
