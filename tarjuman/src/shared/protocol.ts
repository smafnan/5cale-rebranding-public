/**
 * Wire protocol between the browser and the Tarjuman server (one WebSocket per call).
 *
 * Text frames carry JSON messages (`ClientMessage` / `ServerMessage`).
 * Binary frames carry audio, framed as:
 *
 *   [ uint32 big-endian: header length N ][ N bytes: UTF-8 JSON header ][ payload bytes ]
 *
 * - browser -> server: header `AudioUtteranceHeader`, payload = PCM signed 16-bit LE mono
 * - server -> browser: header `SpeechChunkHeader`, payload = one complete, independently
 *   decodable audio file (MP3 unless `mime` says otherwise)
 *
 * This module is dependency-free and runs unchanged in Node and in the browser.
 */

import type { LangCode } from './languages';
import type { ChannelId, SessionSettings } from './settings';

export const PROTOCOL_VERSION = 1;

export const WS_PATH = '/ws';

/** Sample rate of utterance audio sent to the server. */
export const UTTERANCE_SAMPLE_RATE = 16_000;

export const LIMITS = {
  /** Utterances shorter than this are dropped as noise. */
  minUtteranceMs: 250,
  /** Hard server-side cap. The browser segmenter splits long speech well before this. */
  maxUtteranceMs: 30_000,
  /** Cap for typed text and for a single transcript. */
  maxTextChars: 1_200,
  /** Cap for the JSON header of a binary frame. */
  maxHeaderBytes: 16 * 1024,
} as const;

// ---------------------------------------------------------------------------------------
// Provider and server metadata
// ---------------------------------------------------------------------------------------

export type ProviderKind = 'stt' | 'mt' | 'tts';

/**
 * - `ready`: configured and healthy
 * - `cooldown`: temporarily skipped after rate limiting or failures (see `cooldownUntil`)
 * - `unconfigured`: needs an API key that has not been provided
 * - `disabled`: configured but rejected the credentials, or switched off
 */
export type ProviderState = 'ready' | 'cooldown' | 'unconfigured' | 'disabled';

export interface ProviderStatus {
  id: string;
  kind: ProviderKind;
  /** Human-readable name, e.g. "Groq · Whisper large-v3". */
  label: string;
  state: ProviderState;
  /** Position in the fallback chain, 0 = tried first. */
  order: number;
  /** Whether the provider needs an API key at all. */
  requiresKey: boolean;
  /** Short explanation for non-ready states, or the last error. */
  detail?: string;
  /** Epoch ms at which a cooldown ends. */
  cooldownUntil?: number;
}

export interface VoiceInfo {
  /** Provider-specific voice id (e.g. Edge "ShortName": `ur-PK-UzmaNeural`). */
  id: string;
  /** TTS provider id the voice belongs to. */
  provider: string;
  lang: LangCode;
  locale: string;
  label: string;
  gender: 'female' | 'male';
}

export interface ServerInfo {
  name: 'tarjuman';
  version: string;
  protocol: number;
  providers: Record<ProviderKind, ProviderStatus[]>;
  voices: VoiceInfo[];
  /** True when API keys can be saved from the Settings dialog. */
  keysWritable: boolean;
  /** True when the server requires an access token (hosted deployments). */
  authRequired: boolean;
}

// ---------------------------------------------------------------------------------------
// Browser -> server
// ---------------------------------------------------------------------------------------

export type ClientMessage =
  | { type: 'session.start'; protocol: number; settings: SessionSettings }
  | { type: 'session.update'; settings: SessionSettings }
  /** Forget the conversation memory used as translation context. */
  | { type: 'session.reset' }
  /** Typed text, interpreted exactly like a spoken utterance on `channel`. */
  | { type: 'utterance.text'; id: string; channel: ChannelId; text: string }
  /** Abandon an utterance that is still being processed. */
  | { type: 'utterance.cancel'; id: string }
  | { type: 'ping'; t: number };

export interface AudioUtteranceHeader {
  type: 'utterance.audio';
  /** Client-generated unique id; echoed on every event about this utterance. */
  id: string;
  channel: ChannelId;
  sampleRate: number;
  durationMs: number;
  /** Epoch ms (browser clock) at which the speech segment ended. */
  endedAt: number;
  /** True when the segmenter cut a long stretch of speech without waiting for a pause. */
  forcedSplit: boolean;
  /** How much translated speech for this channel is still queued in the browser. */
  playbackLagMs: number;
}

// ---------------------------------------------------------------------------------------
// Server -> browser
// ---------------------------------------------------------------------------------------

export type PipelineStage = 'stt' | 'mt' | 'tts';

export type DropReason =
  /** STT returned nothing, or reported that the audio contains no speech. */
  | 'no_speech'
  /** STT produced a known hallucination (subtitle credits, repetition loops, ...). */
  | 'hallucination'
  | 'too_short'
  | 'too_long'
  | 'cancelled';

export type ErrorCode =
  | 'unauthorized'
  | 'protocol'
  | 'bad_request'
  | 'unconfigured'
  | 'rate_limited'
  | 'timeout'
  | 'provider_failed'
  | 'internal';

export interface UtteranceTimings {
  /** Speech-to-text duration. Absent for typed text. */
  sttMs?: number;
  mtMs?: number;
  /** From the start of synthesis until the first audio chunk was sent. */
  ttsFirstChunkMs?: number;
  ttsMs?: number;
  /** From receipt of the utterance until the last event was sent. */
  totalMs: number;
}

export type ServerMessage =
  | { type: 'session.ready'; sessionId: string; info: ServerInfo }
  | {
      type: 'utterance.transcript';
      id: string;
      channel: ChannelId;
      lang: LangCode;
      text: string;
      provider: string;
      ms: number;
    }
  | {
      type: 'utterance.translation';
      id: string;
      channel: ChannelId;
      /** Keyed by language; always contains the channel's target language. */
      translations: Partial<Record<LangCode, string>>;
      provider: string;
      ms: number;
    }
  | { type: 'utterance.done'; id: string; channel: ChannelId; timings: UtteranceTimings }
  | { type: 'utterance.dropped'; id: string; channel: ChannelId; reason: DropReason; detail?: string }
  | {
      type: 'utterance.error';
      id: string;
      channel: ChannelId;
      stage: PipelineStage;
      code: ErrorCode;
      message: string;
    }
  | { type: 'providers.status'; providers: Record<ProviderKind, ProviderStatus[]> }
  /** Session-level error. `fatal` errors are followed by the server closing the socket. */
  | { type: 'error'; code: ErrorCode; message: string; fatal: boolean }
  | { type: 'pong'; t: number };

export interface SpeechChunkHeader {
  type: 'utterance.speech';
  id: string;
  channel: ChannelId;
  lang: LangCode;
  /** 0-based position of this chunk within the utterance. Chunks arrive in order. */
  index: number;
  /** True on the final chunk of the utterance. */
  last: boolean;
  /** MIME type of the payload, e.g. `audio/mpeg`. */
  mime: string;
  /** The text spoken in this chunk. */
  text: string;
  provider: string;
  voice: string;
}

// ---------------------------------------------------------------------------------------
// Binary framing
// ---------------------------------------------------------------------------------------

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

export function encodeBinaryFrame(
  header: AudioUtteranceHeader | SpeechChunkHeader,
  payload: Uint8Array,
): Uint8Array {
  const headerBytes = textEncoder.encode(JSON.stringify(header));
  if (headerBytes.byteLength > LIMITS.maxHeaderBytes) {
    throw new ProtocolError(`binary frame header too large (${headerBytes.byteLength} bytes)`);
  }
  const frame = new Uint8Array(4 + headerBytes.byteLength + payload.byteLength);
  new DataView(frame.buffer).setUint32(0, headerBytes.byteLength, false);
  frame.set(headerBytes, 4);
  frame.set(payload, 4 + headerBytes.byteLength);
  return frame;
}

export interface DecodedBinaryFrame {
  /** Parsed JSON header. Untrusted: validate before use. */
  header: unknown;
  /** View into the original buffer (no copy). */
  payload: Uint8Array;
}

export function decodeBinaryFrame(data: Uint8Array): DecodedBinaryFrame {
  if (data.byteLength < 4) throw new ProtocolError('binary frame shorter than its length prefix');
  const headerLength = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, false);
  if (headerLength === 0 || headerLength > LIMITS.maxHeaderBytes) {
    throw new ProtocolError(`invalid binary frame header length ${headerLength}`);
  }
  if (4 + headerLength > data.byteLength) throw new ProtocolError('binary frame header is truncated');
  let header: unknown;
  try {
    header = JSON.parse(textDecoder.decode(data.subarray(4, 4 + headerLength)));
  } catch {
    throw new ProtocolError('binary frame header is not valid UTF-8 JSON');
  }
  return { header, payload: data.subarray(4 + headerLength) };
}

// ---------------------------------------------------------------------------------------
// PCM helpers
// ---------------------------------------------------------------------------------------

/** Convert float samples in [-1, 1] to signed 16-bit PCM. */
export function floatToPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Wrap mono 16-bit PCM in a minimal RIFF/WAVE container. */
export function pcm16ToWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = pcm.length * 2;
  const wav = new Uint8Array(44 + dataBytes);
  const view = new DataView(wav.buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i] ?? 0, true);
  return wav;
}

/** Interpret a byte payload as little-endian 16-bit PCM, copying so the result is aligned. */
export function bytesToPcm16(bytes: Uint8Array): Int16Array {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const out = new Int16Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

export function pcm16ToBytes(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < pcm.length; i++) view.setInt16(i * 2, pcm[i] ?? 0, true);
  return out;
}
