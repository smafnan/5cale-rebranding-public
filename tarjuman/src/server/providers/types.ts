/**
 * Provider contracts. The pipeline only ever talks to these interfaces, so swapping a
 * free-tier provider for a paid one later is a registry change, not a pipeline change.
 *
 * Rules every provider follows:
 * - `isConfigured()` is cheap and synchronous (checks for a key, nothing else).
 * - All network work honours `signal` and throws `ProviderError` (never a raw fetch error).
 * - Providers are stateless between calls; rate-limit / cooldown state lives in the
 *   fallback chain, not in the provider.
 */

import type { LangCode } from '../../shared/languages';
import type { ProviderKind, VoiceInfo } from '../../shared/protocol';
import type { Formality, GlossaryEntry } from '../../shared/settings';

export type ProviderErrorKind =
  /** HTTP 429 or an explicit quota error. Honour `retryAfterMs` when present. */
  | 'rate_limit'
  /** Missing, invalid or revoked credentials (401 / 403). Retrying will not help. */
  | 'auth'
  /** The provider rejected the request itself (400 / 404 / 422): wrong model id, bad audio... */
  | 'bad_request'
  /** No answer within the deadline. */
  | 'timeout'
  /** 5xx or a transport failure. */
  | 'unavailable'
  /** The provider answered, but the answer could not be used (unparseable, empty). */
  | 'bad_response'
  /** The caller aborted. */
  | 'aborted';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly providerId: string;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(
    providerId: string,
    kind: ProviderErrorKind,
    message: string,
    options: { status?: number; retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ProviderError';
    this.providerId = providerId;
    this.kind = kind;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export interface ProviderBase {
  /** Stable id used in config, logs and the UI, e.g. `groq-whisper-large-v3`. */
  readonly id: string;
  readonly kind: ProviderKind;
  /** Human-readable name, e.g. "Groq · Whisper large-v3". */
  readonly label: string;
  /** Whether the provider needs an API key at all. */
  readonly requiresKey: boolean;
  /**
   * Client-side request budget per minute. The fallback chain skips the provider instead of
   * provoking a 429 once the budget for the current minute is used up. Omit for "unlimited".
   */
  readonly requestsPerMinute?: number;
  /** Per-request deadline in ms. */
  readonly timeoutMs: number;
  isConfigured(): boolean;
}

// ---------------------------------------------------------------------------------------
// Translation job (shared by STT providers that also translate, and by MT providers)
// ---------------------------------------------------------------------------------------

/** One earlier utterance of the conversation, used as context only. */
export interface ContextTurn {
  /** Who spoke: the local user (`outgoing` channel) or the remote party (`incoming`). */
  speaker: 'me' | 'them';
  lang: LangCode;
  text: string;
}

/** Everything that defines a translation except the words themselves. */
export interface TranslationJob {
  sourceLang: LangCode;
  /** One or more distinct languages, none equal to `sourceLang`. The first is spoken aloud. */
  targetLangs: LangCode[];
  formality: Formality;
  glossary: GlossaryEntry[];
  /** Free-text description of the meeting ("" if none). */
  meetingContext: string;
  /** Most recent turns, oldest first. */
  history: ContextTurn[];
  /**
   * True when the utterance may start or stop mid-sentence because a long stretch of
   * speech was split without waiting for a pause.
   */
  fragment: boolean;
}

// ---------------------------------------------------------------------------------------
// Speech-to-text
// ---------------------------------------------------------------------------------------

export interface SttRequest {
  /** Mono signed 16-bit PCM. */
  pcm: Int16Array;
  sampleRate: number;
  /** Language spoken in the audio. Always given: we never rely on auto-detection. */
  language: LangCode;
  /** Names and terms likely to occur, used to bias spelling. */
  hints: string[];
  /**
   * Translation the pipeline needs for this utterance. Providers that understand audio
   * AND translate (multimodal LLMs) may answer it in the same call by filling
   * `SttResult.translations`; pure speech recognizers ignore it.
   */
  translate?: TranslationJob;
  signal: AbortSignal;
}

export interface SttResult {
  text: string;
  /**
   * Set only by providers that also translated (see `SttRequest.translate`). The pipeline
   * skips the separate translation step when every requested language is present.
   */
  translations?: Partial<Record<LangCode, string>>;
  /**
   * Confidence signals when the model exposes them (Whisper `verbose_json`).
   * Used by the hallucination filter; all optional.
   */
  noSpeechProb?: number;
  avgLogProb?: number;
  compressionRatio?: number;
}

export interface SttProvider extends ProviderBase {
  readonly kind: 'stt';
  supportsLanguage(lang: LangCode): boolean;
  transcribe(request: SttRequest): Promise<SttResult>;
}

// ---------------------------------------------------------------------------------------
// Machine translation
// ---------------------------------------------------------------------------------------

export interface MtRequest extends TranslationJob {
  text: string;
  signal: AbortSignal;
}

export interface MtResult {
  /** A non-empty translation for every requested target language (empty when `skipped`). */
  translations: Partial<Record<LangCode, string>>;
  /**
   * True when the provider judged that there is nothing to translate (noise, a
   * recognition artefact). The pipeline then drops the utterance instead of speaking.
   */
  skipped?: boolean;
}

export interface MtProvider extends ProviderBase {
  readonly kind: 'mt';
  /**
   * True for LLM-based providers that use history, glossary and formality.
   * False for classic MT endpoints that translate the sentence in isolation.
   */
  readonly contextAware: boolean;
  translate(request: MtRequest): Promise<MtResult>;
}

// ---------------------------------------------------------------------------------------
// Text-to-speech
// ---------------------------------------------------------------------------------------

export interface TtsRequest {
  text: string;
  lang: LangCode;
  /** Voice id from `voices()`, or undefined for the provider default for `lang`. */
  voice: string | undefined;
  /** Speaking-rate multiplier, 1 = normal. */
  rate: number;
  signal: AbortSignal;
}

export interface TtsResult {
  /** A complete, independently decodable audio file. */
  audio: Uint8Array;
  mime: string;
  /** The voice that was actually used. */
  voice: string;
}

export interface TtsProvider extends ProviderBase {
  readonly kind: 'tts';
  voices(): VoiceInfo[];
  supportsLanguage(lang: LangCode): boolean;
  synthesize(request: TtsRequest): Promise<TtsResult>;
}

export type AnyProvider = SttProvider | MtProvider | TtsProvider;
