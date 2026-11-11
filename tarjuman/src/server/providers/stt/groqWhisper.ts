import type { LangCode } from '../../../shared/languages';
import { pcm16ToWav } from '../../../shared/protocol';
import { httpRequest, readJson } from '../http';
import { ProviderError, type SttProvider, type SttRequest, type SttResult } from '../types';

/**
 * Whisper on Groq's OpenAI-compatible transcription endpoint.
 *
 * Free tier (per model, per organisation): 20 requests/min, 2,000 requests/day,
 * 7,200 audio-seconds/hour. Each Whisper model has its own bucket, which is why
 * large-v3 and large-v3-turbo are registered as two providers.
 */

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';

/** Whisper accepts a prompt of at most 224 tokens; stay well below with a character cap. */
const MAX_PROMPT_CHARS = 400;

interface WhisperSegment {
  start?: number;
  end?: number;
  avg_logprob?: number;
  compression_ratio?: number;
  no_speech_prob?: number;
}

interface WhisperVerboseResponse {
  text?: string;
  segments?: WhisperSegment[];
}

/**
 * Opening sentence of the Whisper prompt, per language. Exported because Whisper sometimes
 * echoes its prompt back when the audio is unintelligible; the hallucination filter needs
 * to recognise that.
 */
export const WHISPER_PROMPT_LEAD: Record<LangCode, string> = {
  ur: 'یہ ایک کاروباری میٹنگ کی گفتگو ہے۔',
  de: 'Dies ist ein Gespräch in einem geschäftlichen Meeting.',
  en: 'This is a conversation in a business meeting.',
};

/**
 * A short text in the spoken language that biases Whisper towards the right script and the
 * right spelling of names and terms. Whisper treats the prompt as "what was said just before".
 */
export function buildWhisperPrompt(language: LangCode, hints: readonly string[]): string {
  let prompt = WHISPER_PROMPT_LEAD[language];
  const terms: string[] = [];
  for (const hint of hints) {
    const term = hint.trim();
    if (!term) continue;
    if (prompt.length + terms.join(', ').length + term.length + 2 > MAX_PROMPT_CHARS) break;
    terms.push(term);
  }
  if (terms.length > 0) prompt += ` ${terms.join(', ')}.`;
  return prompt;
}

/** Combine per-segment confidence signals into one figure per utterance. */
export function summarizeSegments(segments: readonly WhisperSegment[]): Omit<SttResult, 'text'> {
  let weight = 0;
  let logProbSum = 0;
  let noSpeechSum = 0;
  let compression: number | undefined;
  for (const segment of segments) {
    const duration = Math.max(0.05, (segment.end ?? 0) - (segment.start ?? 0));
    if (typeof segment.avg_logprob === 'number' && typeof segment.no_speech_prob === 'number') {
      weight += duration;
      logProbSum += segment.avg_logprob * duration;
      noSpeechSum += segment.no_speech_prob * duration;
    }
    if (typeof segment.compression_ratio === 'number') {
      compression = Math.max(compression ?? 0, segment.compression_ratio);
    }
  }
  if (weight === 0) return { compressionRatio: compression };
  return {
    avgLogProb: logProbSum / weight,
    noSpeechProb: noSpeechSum / weight,
    compressionRatio: compression,
  };
}

export interface GroqWhisperOptions {
  id: string;
  model: string;
  getKey: () => string | undefined;
  fetchImpl?: typeof fetch;
}

export class GroqWhisperProvider implements SttProvider {
  readonly kind = 'stt' as const;
  readonly requiresKey = true;
  /** Stay just under the documented 20 requests/min so we fall over before provoking a 429. */
  readonly requestsPerMinute = 18;
  readonly timeoutMs = 8_000;
  readonly id: string;
  readonly label: string;

  constructor(private readonly options: GroqWhisperOptions) {
    this.id = options.id;
    this.label = `Groq · ${options.model}`;
  }

  isConfigured(): boolean {
    return Boolean(this.options.getKey());
  }

  supportsLanguage(): boolean {
    return true;
  }

  async transcribe(request: SttRequest): Promise<SttResult> {
    const apiKey = this.options.getKey();
    if (!apiKey) throw new ProviderError(this.id, 'auth', 'GROQ_API_KEY is not set');

    const wav = pcm16ToWav(request.pcm, request.sampleRate);
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'utterance.wav');
    form.append('model', this.options.model);
    // Always pin the language: auto-detection turns Urdu into Hindi (Devanagari) far too often.
    form.append('language', request.language);
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    form.append('prompt', buildWhisperPrompt(request.language, request.hints));

    const response = await httpRequest({
      providerId: this.id,
      url: ENDPOINT,
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: request.signal,
      fetchImpl: this.options.fetchImpl,
    });
    const json = await readJson<WhisperVerboseResponse>(this.id, response);
    if (typeof json.text !== 'string') {
      throw new ProviderError(this.id, 'bad_response', 'transcription response has no "text" field');
    }
    return { text: json.text, ...summarizeSegments(json.segments ?? []) };
  }
}
