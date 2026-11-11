import { pcm16ToWav } from '../../shared/protocol';
import { httpRequest, readJson } from './http';
import {
  answerJsonSchema,
  buildAudioUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  parseInterpreterAnswer,
} from './mt/prompt';
import {
  ProviderError,
  type MtProvider,
  type MtRequest,
  type MtResult,
  type SttProvider,
  type SttRequest,
  type SttResult,
} from './types';

/**
 * Google Gemini API (AI Studio key), used three ways with one key:
 *
 * - `GeminiMtProvider`        text translation with a Flash-Lite model
 * - `GeminiAudioSttProvider`  audio in, transcript AND translations out, in one call
 * - `GemmaMtProvider`         text translation with an open Gemma model (separate quota)
 *
 * The API surface moves quickly (model ids are retired, request fields are renamed), and
 * this code cannot be exercised against the live API in CI. It therefore degrades instead
 * of breaking:
 *
 * - every provider has an ordered list of candidate model ids and advances on HTTP 404;
 * - requests are tried in up to three "shapes", from the most to the least featureful,
 *   and the first shape a model accepts is remembered.
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Request shapes, most featureful first.
 * - `full`:   system instruction + strict JSON schema + minimal thinking
 * - `schema`: same without the thinking setting (models that reject or lack it)
 * - `bare`:   instructions inlined into the user turn, plain-text answer parsed as JSON
 *             (Gemma models accept neither system instructions nor JSON mode)
 */
export type GeminiShape = 'full' | 'schema' | 'bare';

const SHAPE_LADDER: GeminiShape[] = ['full', 'schema', 'bare'];

interface GeminiPart {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

export interface GeminiCallOptions {
  providerId: string;
  apiKey: string;
  model: string;
  shape: GeminiShape;
  system: string;
  userParts: GeminiPart[];
  schema: Record<string, unknown>;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}

export function buildGeminiBody(
  options: Pick<GeminiCallOptions, 'shape' | 'system' | 'userParts' | 'schema'>,
) {
  const { shape, system, userParts, schema } = options;
  if (shape === 'bare') {
    return {
      contents: [{ role: 'user', parts: [{ text: system }, ...userParts] }],
      generationConfig: { maxOutputTokens: 2048 },
    };
  }
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: userParts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
      // The cap includes thinking tokens on some models, so it is deliberately generous.
      maxOutputTokens: 2048,
      ...(shape === 'full' ? { thinkingConfig: { thinkingLevel: 'MINIMAL' } } : {}),
    },
  };
}

/** One generateContent call. Returns the visible answer text. */
export async function geminiGenerate(options: GeminiCallOptions): Promise<string> {
  const { providerId } = options;
  const response = await httpRequest({
    providerId,
    url: `${API_BASE}/models/${encodeURIComponent(options.model)}:generateContent`,
    // The key travels in a header, never in the URL, so it cannot leak into logs.
    headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
    body: JSON.stringify(buildGeminiBody(options)),
    signal: options.signal,
    fetchImpl: options.fetchImpl,
  });
  const json = await readJson<GeminiResponse>(providerId, response);

  const blockReason = json.promptFeedback?.blockReason;
  if (blockReason)
    throw new ProviderError(providerId, 'bad_response', `request blocked by the model (${blockReason})`);

  const candidate = json.candidates?.[0];
  const reason = candidate?.finishReason;
  // Anything but a normal stop (MAX_TOKENS, SAFETY, RECITATION, ...) means the answer is
  // cut off or withheld; a truncated translation must not be spoken.
  if (reason && reason !== 'STOP') {
    throw new ProviderError(providerId, 'bad_response', `model stopped early (${reason})`);
  }
  const text = (candidate?.content?.parts ?? [])
    .filter((part) => part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
  if (!text.trim()) {
    throw new ProviderError(
      providerId,
      'bad_response',
      `model returned no text (${reason ?? 'no candidates'})`,
    );
  }
  return text;
}

/**
 * Remembers which model id and request shape work, and walks the candidates when the API
 * says "no such model" (404) or "I do not understand this request" (400).
 */
export class GeminiNegotiator {
  private modelIndex = 0;
  private shapeIndex: number;

  constructor(
    private readonly models: readonly string[],
    firstShape: GeminiShape = 'full',
  ) {
    if (models.length === 0) throw new Error('GeminiNegotiator needs at least one model id');
    this.shapeIndex = SHAPE_LADDER.indexOf(firstShape);
  }

  get model(): string {
    return this.models[this.modelIndex] ?? (this.models[0] as string);
  }

  get shape(): GeminiShape {
    return SHAPE_LADDER[this.shapeIndex] ?? 'bare';
  }

  /** A request shape that has worked once is kept: later 400s are about the request, not the shape. */
  private shapeProven = false;

  /**
   * Run `call` with the current model and shape; on 404 move to the next model, on 400 to the
   * next shape, and retry. Progress is kept for later calls. Other errors propagate untouched.
   *
   * Several requests can be in flight at once (both channels speaking). Each failure therefore
   * only advances an index if that index is still the one the failed call used; otherwise
   * another request already advanced it, and this one simply retries with the new value.
   */
  async run<T>(call: (model: string, shape: GeminiShape) => Promise<T>): Promise<T> {
    // Bounded: each iteration returns, throws, or observes an index further along than before.
    for (;;) {
      const usedModel = this.modelIndex;
      const usedShape = this.shapeIndex;
      try {
        const value = await call(this.model, this.shape);
        if (usedShape === this.shapeIndex) this.shapeProven = true;
        return value;
      } catch (error) {
        if (!(error instanceof ProviderError) || error.kind !== 'bad_request') throw error;
        if (error.status === 404) {
          if (usedModel !== this.modelIndex) continue;
          if (this.modelIndex < this.models.length - 1) {
            this.modelIndex += 1;
            // A different model may want a different request shape.
            this.shapeProven = false;
            continue;
          }
        } else if (error.status === 400) {
          if (usedShape !== this.shapeIndex) continue;
          if (!this.shapeProven && this.shapeIndex < SHAPE_LADDER.length - 1) {
            this.shapeIndex += 1;
            continue;
          }
        }
        throw error;
      }
    }
  }
}

export interface GeminiProviderOptions {
  /** Returns the current API key, or undefined when none is set. */
  getKey: () => string | undefined;
  /** Candidate model ids, most preferred first. */
  models: readonly string[];
  fetchImpl?: typeof fetch;
}

function requireKey(providerId: string, getKey: () => string | undefined): string {
  const key = getKey();
  if (!key) throw new ProviderError(providerId, 'auth', 'GEMINI_API_KEY is not set');
  return key;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

abstract class GeminiTextMt implements MtProvider {
  readonly kind = 'mt' as const;
  readonly requiresKey = true;
  readonly contextAware = true;
  abstract readonly id: string;
  abstract readonly label: string;
  abstract readonly requestsPerMinute: number;
  abstract readonly timeoutMs: number;
  protected abstract readonly negotiator: GeminiNegotiator;

  constructor(protected readonly options: GeminiProviderOptions) {}

  isConfigured(): boolean {
    return Boolean(this.options.getKey());
  }

  async translate(request: MtRequest): Promise<MtResult> {
    const apiKey = requireKey(this.id, this.options.getKey);
    const raw = await this.negotiator.run((model, shape) =>
      geminiGenerate({
        providerId: this.id,
        apiKey,
        model,
        shape,
        system: buildSystemPrompt(request, 'text'),
        userParts: [{ text: buildUserPrompt(request, request.text) }],
        schema: answerJsonSchema(request, false),
        signal: request.signal,
        fetchImpl: this.options.fetchImpl,
      }),
    );
    const answer = parseInterpreterAnswer(this.id, raw, request, {
      withTranscript: false,
      sourceText: request.text,
    });
    return { translations: answer.translations, skipped: answer.skip };
  }
}

/** Text translation with a Gemini Flash-Lite model. */
export class GeminiMtProvider extends GeminiTextMt {
  readonly id = 'gemini-flash-lite';
  readonly requestsPerMinute = 6;
  readonly timeoutMs = 7_000;
  protected readonly negotiator: GeminiNegotiator;

  constructor(options: GeminiProviderOptions) {
    super(options);
    this.negotiator = new GeminiNegotiator(options.models, 'full');
  }

  get label(): string {
    return `Google · ${this.negotiator.model}`;
  }
}

/** Text translation with an open Gemma model served by the Gemini API (its own free quota). */
export class GemmaMtProvider extends GeminiTextMt {
  readonly id = 'gemma';
  readonly requestsPerMinute = 12;
  readonly timeoutMs = 9_000;
  protected readonly negotiator: GeminiNegotiator;

  constructor(options: GeminiProviderOptions) {
    super(options);
    // Current Gemma models are reported to accept system instructions and JSON schemas; older
    // ones accept neither. Start with the full request and let the negotiator step down.
    this.negotiator = new GeminiNegotiator(options.models, 'full');
  }

  get label(): string {
    return `Google · ${this.negotiator.model}`;
  }
}

/**
 * Audio in, transcript and translations out, in one call.
 *
 * For Urdu this is markedly more accurate than Whisper (especially when English terms
 * are mixed in), and it saves a network round trip because no separate translation call
 * is needed.
 */
export class GeminiAudioSttProvider implements SttProvider {
  readonly id = 'gemini-audio';
  readonly kind = 'stt' as const;
  readonly requiresKey = true;
  readonly requestsPerMinute = 8;
  readonly timeoutMs = 9_000;
  private readonly negotiator: GeminiNegotiator;

  constructor(private readonly options: GeminiProviderOptions) {
    this.negotiator = new GeminiNegotiator(options.models, 'full');
  }

  get label(): string {
    return `Google · ${this.negotiator.model} (audio)`;
  }

  isConfigured(): boolean {
    return Boolean(this.options.getKey());
  }

  supportsLanguage(): boolean {
    return true;
  }

  async transcribe(request: SttRequest): Promise<SttResult> {
    const apiKey = requireKey(this.id, this.options.getKey);
    // Without a translation job we still use the interpreter prompt, asking only for English,
    // so there is a single prompt to maintain; the extra field is simply ignored.
    const job = request.translate ?? {
      sourceLang: request.language,
      targetLangs: [request.language === 'en' ? 'de' : 'en'],
      formality: 'formal' as const,
      glossary: request.hints.map((term) => ({ term, translation: '' })),
      meetingContext: '',
      history: [],
      fragment: false,
    };
    const wav = pcm16ToWav(request.pcm, request.sampleRate);
    const raw = await this.negotiator.run((model, shape) =>
      geminiGenerate({
        providerId: this.id,
        apiKey,
        model,
        shape,
        system: buildSystemPrompt(job, 'audio'),
        userParts: [
          { inlineData: { mimeType: 'audio/wav', data: toBase64(wav) } },
          { text: buildAudioUserPrompt(job) },
        ],
        schema: answerJsonSchema(job, true),
        signal: request.signal,
        fetchImpl: this.options.fetchImpl,
      }),
    );
    const answer = parseInterpreterAnswer(this.id, raw, job, { withTranscript: true });
    if (answer.skip) return { text: '' };
    return {
      text: answer.transcript,
      translations: request.translate ? answer.translations : undefined,
    };
  }
}
