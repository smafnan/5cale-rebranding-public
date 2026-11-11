import type { LangCode } from '../../shared/languages';
import {
  encodeBinaryFrame,
  LIMITS,
  UTTERANCE_SAMPLE_RATE,
  type AudioUtteranceHeader,
  type DropReason,
  type ErrorCode,
  type PipelineStage,
  type ServerMessage,
  type UtteranceTimings,
} from '../../shared/protocol';
import {
  DEFAULT_SESSION_SETTINGS,
  translationTargets,
  type ChannelId,
  type ChannelSettings,
  type SessionSettings,
} from '../../shared/settings';
import { AbortedError, ChainExhaustedError, NoProviderError, type FallbackChain } from '../providers/chain';
import type { MtProvider, SttProvider, TranslationJob, TtsProvider } from '../providers/types';
import { judgeTranscript } from './hallucination';
import { ConversationMemory } from './memory';
import { effectiveSpeechRate, normalizeTranscript, pcmRms, splitForSpeech } from './text';

/**
 * One interpreted call: turns utterances (audio or typed text) into transcript,
 * translation and speech events for one WebSocket connection.
 *
 * Concurrency model, per channel:
 *
 *   utterance N    [ STT ]──▶[ translate ]──▶[ synthesize + send ]
 *   utterance N+1     [ STT ]─────▶[ translate ]────▶[ synthesize + send ]
 *
 * - Speech recognition starts the moment audio arrives, for every utterance in parallel.
 * - Translation runs strictly in arrival order (the "text lane"), because each
 *   utterance is context for the next one.
 * - Speech is synthesized and sent strictly in order on a second lane, so translating
 *   utterance N+1 never waits for the audio of utterance N.
 */

export interface SessionLogger {
  debug(obj: object, msg: string): void;
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface SessionTransport {
  send(message: ServerMessage): void;
  sendBinary(frame: Uint8Array): void;
}

export interface PipelineChains {
  stt: FallbackChain<SttProvider>;
  mt: FallbackChain<MtProvider>;
  tts: FallbackChain<TtsProvider>;
  /** Per-language preference among STT providers; lower is tried first. */
  sttRank: (provider: SttProvider, lang: LangCode) => number;
}

export interface SessionOptions {
  chains: PipelineChains;
  transport: SessionTransport;
  logger: SessionLogger;
  /** Include transcripts and translations in debug logs. Off unless explicitly enabled. */
  logTranscripts?: boolean;
  now?: () => number;
}

/** Upper bound of utterances being processed at once; protects quotas if the client misbehaves. */
const MAX_IN_FLIGHT = 12;

/** Audio quieter than this (RMS, full scale = 1) cannot contain usable speech. */
const SILENCE_RMS = 0.0015;

/** Start a second provider in parallel when the first has not answered after this long. */
const STT_HEDGE_MS = 2_500;
const MT_HEDGE_MS = 2_200;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

interface Utterance {
  id: string;
  channel: ChannelId;
  /** Channel settings as they were when the utterance arrived. */
  settings: ChannelSettings;
  job: Omit<TranslationJob, 'history'>;
  controller: AbortController;
  receivedAt: number;
  playbackLagMs: number;
  timings: Omit<UtteranceTimings, 'totalMs'>;
}

class StageFailure extends Error {
  constructor(
    readonly stage: PipelineStage,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function errorCodeOf(error: unknown): ErrorCode {
  if (error instanceof NoProviderError || error instanceof ChainExhaustedError) return error.code;
  return 'internal';
}

function errorMessageOf(error: unknown): string {
  if (error instanceof NoProviderError) return error.message;
  if (error instanceof ChainExhaustedError) {
    const last = error.attempts[error.attempts.length - 1];
    return last ? `${last.providerId}: ${last.message ?? last.outcome}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export class InterpreterSession {
  private settings: SessionSettings = DEFAULT_SESSION_SETTINGS;
  private readonly memory = new ConversationMemory();
  private readonly inFlight = new Map<string, Utterance>();
  private readonly textLane: Record<ChannelId, Promise<void>> = {
    outgoing: Promise.resolve(),
    incoming: Promise.resolve(),
  };
  private readonly speechLane: Record<ChannelId, Promise<void>> = {
    outgoing: Promise.resolve(),
    incoming: Promise.resolve(),
  };
  private closed = false;
  private readonly chains: PipelineChains;
  private readonly transport: SessionTransport;
  private readonly logger: SessionLogger;
  private readonly logTranscripts: boolean;
  private readonly now: () => number;

  constructor(options: SessionOptions) {
    this.chains = options.chains;
    this.transport = options.transport;
    this.logger = options.logger;
    this.logTranscripts = options.logTranscripts ?? false;
    this.now = options.now ?? Date.now;
  }

  updateSettings(settings: SessionSettings): void {
    this.settings = settings;
  }

  /** Forget the conversation context (new topic or new meeting). */
  resetContext(): void {
    this.memory.clear();
  }

  /** Number of utterances currently being processed. */
  get pending(): number {
    return this.inFlight.size;
  }

  /** Resolves when everything submitted so far has been fully processed (used by tests). */
  async idle(): Promise<void> {
    for (;;) {
      const lanes = [...Object.values(this.textLane), ...Object.values(this.speechLane)];
      await Promise.all(lanes);
      if (this.inFlight.size === 0) return;
      // A lane was extended while we were waiting: go round again.
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  cancel(id: string): void {
    this.inFlight.get(id)?.controller.abort();
  }

  /** Abort everything; no further events are sent. */
  close(): void {
    this.closed = true;
    for (const utterance of this.inFlight.values()) utterance.controller.abort();
    this.inFlight.clear();
  }

  // -------------------------------------------------------------------------------------
  // Entry points
  // -------------------------------------------------------------------------------------

  submitAudio(header: AudioUtteranceHeader, pcm: Int16Array): void {
    if (this.closed) return;
    const { id, channel } = header;
    if (!this.admit(id, channel, 'stt')) return;

    if (header.sampleRate !== UTTERANCE_SAMPLE_RATE) {
      this.emitError(id, channel, 'stt', 'bad_request', `audio must be ${UTTERANCE_SAMPLE_RATE} Hz mono PCM`);
      return;
    }
    // Trust the payload, not the header, for the duration.
    const audioMs = Math.round((pcm.length / UTTERANCE_SAMPLE_RATE) * 1000);
    if (audioMs < LIMITS.minUtteranceMs) return this.emitDropped(id, channel, 'too_short');
    if (audioMs > LIMITS.maxUtteranceMs) return this.emitDropped(id, channel, 'too_long');
    if (pcmRms(pcm) < SILENCE_RMS) return this.emitDropped(id, channel, 'no_speech', 'silent audio');

    const utterance = this.begin(id, channel, header.playbackLagMs, header.forcedSplit);
    const language = utterance.job.sourceLang;
    const hints = this.settings.glossary.map((entry) => entry.term);

    // Recognition starts immediately, in parallel with whatever is still in the lanes.
    const sttStartedAt = this.now();
    const recognition = this.chains.stt
      .run(
        (provider, signal) =>
          provider.transcribe({
            pcm,
            sampleRate: header.sampleRate,
            language,
            hints,
            translate: { ...utterance.job, history: this.memory.recent() },
            signal,
          }),
        {
          signal: utterance.controller.signal,
          filter: (provider) => provider.supportsLanguage(language),
          rank: (provider) => this.chains.sttRank(provider, language),
          hedgeAfterMs: STT_HEDGE_MS,
        },
      )
      .then((run) => ({ run, ms: this.now() - sttStartedAt }));
    // The lane awaits this later; make sure an early rejection is not reported as unhandled.
    recognition.catch(() => undefined);

    this.onTextLane(utterance, async () => {
      let recognized: Awaited<typeof recognition>;
      try {
        recognized = await recognition;
      } catch (error) {
        throw this.stageFailure('stt', error);
      }
      const { run, ms } = recognized;
      utterance.timings.sttMs = ms;

      const text = normalizeTranscript(run.value.text).slice(0, LIMITS.maxTextChars);
      const verdict = judgeTranscript(text, { lang: language, audioMs, signals: run.value, hints });
      if (!verdict.keep) {
        this.finish(utterance);
        this.emitDropped(id, channel, verdict.reason, verdict.detail);
        return;
      }
      this.transport.send({
        type: 'utterance.transcript',
        id,
        channel,
        lang: language,
        text,
        provider: run.provider.id,
        ms,
      });
      await this.translate(utterance, text, {
        translations: run.value.translations,
        provider: run.provider.id,
      });
    });
  }

  submitText(id: string, channel: ChannelId, rawText: string): void {
    if (this.closed) return;
    if (!this.admit(id, channel, 'mt')) return;

    // Typed text is taken as written. (The transcript clean-up removes bracketed annotations,
    // which is right for recognizer output and wrong for what a person typed.)
    const text = rawText.replace(/\s+/g, ' ').trim();
    if (!text) return this.emitDropped(id, channel, 'no_speech', 'empty text');
    if (text.length > LIMITS.maxTextChars) {
      this.emitError(
        id,
        channel,
        'mt',
        'bad_request',
        `text is longer than ${LIMITS.maxTextChars} characters`,
      );
      return;
    }

    const utterance = this.begin(id, channel, 0, false);
    this.transport.send({
      type: 'utterance.transcript',
      id,
      channel,
      lang: utterance.job.sourceLang,
      text,
      provider: 'keyboard',
      ms: 0,
    });
    this.onTextLane(utterance, () => this.translate(utterance, text, undefined));
  }

  // -------------------------------------------------------------------------------------
  // Stages
  // -------------------------------------------------------------------------------------

  private async translate(
    utterance: Utterance,
    text: string,
    fromRecognizer:
      { translations: Partial<Record<LangCode, string>> | undefined; provider: string } | undefined,
  ): Promise<void> {
    const { id, channel, job } = utterance;
    const speaker = channel === 'outgoing' ? 'me' : 'them';

    let translations: Partial<Record<LangCode, string>>;
    let provider: string;
    let ms = 0;

    const precomputed = fromRecognizer?.translations;
    if (precomputed && job.targetLangs.every((lang) => Boolean(precomputed[lang]))) {
      // The recognizer was a multimodal model that already translated in the same call.
      translations = precomputed;
      provider = fromRecognizer.provider;
    } else {
      const startedAt = this.now();
      let run;
      try {
        run = await this.chains.mt.run(
          (mt, signal) => mt.translate({ ...job, history: this.memory.recent(), text, signal }),
          { signal: utterance.controller.signal, hedgeAfterMs: MT_HEDGE_MS },
        );
      } catch (error) {
        // Keep the source in memory even when translation failed: it is still context.
        this.memory.add({ speaker, lang: job.sourceLang, text });
        throw this.stageFailure('mt', error);
      }
      ms = this.now() - startedAt;
      if (run.value.skipped) {
        this.finish(utterance);
        this.emitDropped(id, channel, 'hallucination', 'nothing to translate');
        return;
      }
      translations = run.value.translations;
      provider = run.provider.id;
    }

    const spoken = translations[utterance.settings.targetLang];
    if (!spoken)
      throw new StageFailure('mt', 'provider_failed', 'translation is missing the target language');

    utterance.timings.mtMs = ms;
    this.memory.add({ speaker, lang: job.sourceLang, text });
    this.transport.send({ type: 'utterance.translation', id, channel, translations, provider, ms });
    if (this.logTranscripts) this.logger.debug({ id, channel, text, translations }, 'utterance translated');

    // Hand over to the speech lane and return, so the next utterance can be translated now.
    this.onSpeechLane(utterance, async () => {
      if (utterance.settings.speak) await this.speak(utterance, spoken);
      this.finish(utterance);
      const timings: UtteranceTimings = { ...utterance.timings, totalMs: this.now() - utterance.receivedAt };
      this.transport.send({ type: 'utterance.done', id, channel, timings });
      this.logger.debug({ id, channel, ...timings }, 'utterance done');
    });
  }

  private async speak(utterance: Utterance, text: string): Promise<void> {
    const { id, channel, settings } = utterance;
    const lang = settings.targetLang;
    const chunks = splitForSpeech(text, lang);
    if (chunks.length === 0) return;

    const rate = effectiveSpeechRate(settings.speechRate, utterance.playbackLagMs);
    const voice = settings.voice === 'auto' ? undefined : settings.voice;
    const startedAt = this.now();

    const synthesize = (chunk: string) => {
      const pending = this.chains.tts.run(
        (tts, signal) => tts.synthesize({ text: chunk, lang, voice, rate, signal }),
        {
          signal: utterance.controller.signal,
          filter: (tts) => tts.supportsLanguage(lang),
        },
      );
      pending.catch(() => undefined);
      return pending;
    };

    // Look-ahead of one: chunk i+1 is synthesized while chunk i is delivered and played.
    let next: ReturnType<typeof synthesize> | undefined = synthesize(chunks[0] as string);
    for (let index = 0; index < chunks.length; index++) {
      const current = next;
      if (!current) break;
      const upcoming = chunks[index + 1];
      next = upcoming === undefined ? undefined : synthesize(upcoming);

      let run;
      try {
        run = await current;
      } catch (error) {
        throw this.stageFailure('tts', error);
      }
      if (this.closed) return;
      if (index === 0) utterance.timings.ttsFirstChunkMs = this.now() - startedAt;
      this.transport.sendBinary(
        encodeBinaryFrame(
          {
            type: 'utterance.speech',
            id,
            channel,
            lang,
            index,
            last: index === chunks.length - 1,
            mime: run.value.mime,
            text: chunks[index] as string,
            provider: run.provider.id,
            voice: run.value.voice,
          },
          run.value.audio,
        ),
      );
    }
    utterance.timings.ttsMs = this.now() - startedAt;
  }

  // -------------------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------------------

  /** Common admission checks. Returns false (after reporting) when the utterance is rejected. */
  private admit(id: string, channel: ChannelId, stage: PipelineStage): boolean {
    if (!ID_PATTERN.test(id)) {
      this.transport.send({ type: 'error', code: 'protocol', message: 'invalid utterance id', fatal: false });
      return false;
    }
    if (this.inFlight.has(id)) {
      this.emitError(id, channel, stage, 'bad_request', 'duplicate utterance id');
      return false;
    }
    if (this.inFlight.size >= MAX_IN_FLIGHT) {
      this.emitError(id, channel, stage, 'rate_limited', 'too many utterances are still being processed');
      return false;
    }
    return true;
  }

  private begin(id: string, channel: ChannelId, playbackLagMs: number, fragment: boolean): Utterance {
    const settings = this.settings.channels[channel];
    const utterance: Utterance = {
      id,
      channel,
      settings,
      job: {
        sourceLang: settings.sourceLang,
        targetLangs: translationTargets(this.settings, channel),
        formality: this.settings.formality,
        glossary: this.settings.glossary,
        meetingContext: this.settings.meetingContext,
        fragment,
      },
      controller: new AbortController(),
      receivedAt: this.now(),
      playbackLagMs: Number.isFinite(playbackLagMs) ? Math.max(0, playbackLagMs) : 0,
      timings: {},
    };
    this.inFlight.set(id, utterance);
    return utterance;
  }

  private finish(utterance: Utterance): void {
    this.inFlight.delete(utterance.id);
  }

  private onTextLane(utterance: Utterance, task: () => Promise<void>): void {
    const lane = this.textLane[utterance.channel].then(() => this.guard(utterance, task));
    this.textLane[utterance.channel] = lane;
  }

  private onSpeechLane(utterance: Utterance, task: () => Promise<void>): void {
    const lane = this.speechLane[utterance.channel].then(() => this.guard(utterance, task));
    this.speechLane[utterance.channel] = lane;
  }

  /** Run a lane task; convert every failure into exactly one event. Never rejects. */
  private async guard(utterance: Utterance, task: () => Promise<void>): Promise<void> {
    if (this.closed) return;
    try {
      if (utterance.controller.signal.aborted) throw new AbortedError();
      await task();
    } catch (error) {
      this.finish(utterance);
      if (this.closed) return;
      const { id, channel } = utterance;
      if (error instanceof AbortedError || utterance.controller.signal.aborted) {
        this.emitDropped(id, channel, 'cancelled');
      } else if (error instanceof StageFailure) {
        this.emitError(id, channel, error.stage, error.code, error.message);
      } else {
        this.logger.error({ id, channel, err: error }, 'unexpected pipeline failure');
        this.emitError(id, channel, 'mt', 'internal', 'internal error');
      }
    }
  }

  private stageFailure(stage: PipelineStage, error: unknown): Error {
    if (error instanceof AbortedError) return error;
    if (error instanceof StageFailure) return error;
    return new StageFailure(stage, errorCodeOf(error), errorMessageOf(error));
  }

  private emitDropped(id: string, channel: ChannelId, reason: DropReason, detail?: string): void {
    this.transport.send({ type: 'utterance.dropped', id, channel, reason, detail });
  }

  private emitError(
    id: string,
    channel: ChannelId,
    stage: PipelineStage,
    code: ErrorCode,
    message: string,
  ): void {
    this.logger.warn({ id, channel, stage, code, message }, 'utterance failed');
    this.transport.send({ type: 'utterance.error', id, channel, stage, code, message });
  }
}
