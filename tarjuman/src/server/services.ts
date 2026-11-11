import pkg from '../../package.json';
import type { DiagnosticResult, DiagnosticsReport } from '../shared/api';
import type { LangCode } from '../shared/languages';
import {
  PROTOCOL_VERSION,
  UTTERANCE_SAMPLE_RATE,
  type ProviderKind,
  type ProviderStatus,
  type ServerInfo,
  type VoiceInfo,
} from '../shared/protocol';
import type { AppConfig } from './config';
import { KeyStore, type KeyDefinition } from './keys';
import type { PipelineChains } from './pipeline/session';
import { FallbackChain } from './providers/chain';
import { GeminiAudioSttProvider, GeminiMtProvider, GemmaMtProvider } from './providers/gemini';
import { MockMtProvider, MockSttProvider, MockTtsProvider } from './providers/mock';
import { MyMemoryProvider } from './providers/mt/myMemory';
import { OpenAiCompatMtProvider } from './providers/mt/openaiCompat';
import { GroqWhisperProvider } from './providers/stt/groqWhisper';
import { AzureTtsProvider } from './providers/tts/azure';
import { EdgeTtsProvider } from './providers/tts/edge';
import type { AnyProvider, MtProvider, ProviderBase, SttProvider, TtsProvider } from './providers/types';

/**
 * Composition root: the one place that knows which concrete providers exist, in which
 * order they are tried, and which keys they need. Everything else depends on `Services`.
 *
 * To add a provider: implement the interface from providers/types.ts, construct it in
 * `buildProviders`, and (if it needs a key) describe the key in `KEY_DEFINITIONS`.
 */

export const KEY_DEFINITIONS: KeyDefinition[] = [
  {
    name: 'GROQ_API_KEY',
    label: 'Groq',
    description:
      'Speech recognition (Whisper large-v3) and fast translation models. Free tier, no credit card. ' +
      'This is the one key Tarjuman needs to understand speech.',
    signupUrl: 'https://console.groq.com/keys',
    recommended: true,
  },
  {
    name: 'GEMINI_API_KEY',
    aliases: ['GOOGLE_API_KEY'],
    label: 'Google AI Studio (Gemini)',
    description:
      'Most accurate Urdu: hears the audio and translates in one step. Free tier, no credit card. ' +
      "Note: Google's terms require its paid tier for applications offered to users in the EEA, the UK and Switzerland; check them before relying on the free tier there.",
    signupUrl: 'https://aistudio.google.com/apikey',
    recommended: true,
  },
  {
    name: 'AZURE_SPEECH_KEY',
    label: 'Azure AI Speech (optional)',
    description:
      'Official Microsoft neural voices (free F0 tier: 0.5 million characters per month). ' +
      'Enter as region:key, for example westeurope:0123abcd…',
    signupUrl: 'https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices',
    recommended: false,
  },
  {
    name: 'OPENAI_COMPAT_API_KEY',
    label: 'Custom OpenAI-compatible endpoint (optional)',
    description:
      'Key for the translation endpoint set with OPENAI_COMPAT_BASE_URL and OPENAI_COMPAT_MODEL ' +
      '(OpenRouter, a paid provider, or a local Ollama server).',
    signupUrl: 'https://openrouter.ai/keys',
    recommended: false,
  },
];

/** Default model ids. All can be overridden from the environment (see .env.example). */
const DEFAULTS = {
  geminiModels: [
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite',
  ],
  gemmaModels: ['gemma-4-31b-it', 'gemma-4-26b-a4b-it', 'gemma-3-27b-it'],
  groqSttModels: ['whisper-large-v3', 'whisper-large-v3-turbo'],
  groqMtModels: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
};

/**
 * Per-language preference among speech recognizers (ids, best first).
 *
 * Urdu: a multimodal LLM that hears the audio is far more accurate than Whisper, above all
 * when English terms are mixed in. German and English: Whisper is excellent and faster, and
 * keeping them off Gemini saves its small free quota for Urdu.
 */
const STT_PREFERENCE: Record<LangCode, string[]> = {
  ur: ['gemini-audio', 'groq-whisper-large-v3', 'groq-whisper-large-v3-turbo'],
  de: ['groq-whisper-large-v3', 'groq-whisper-large-v3-turbo', 'gemini-audio'],
  en: ['groq-whisper-large-v3', 'groq-whisper-large-v3-turbo', 'gemini-audio'],
};

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function slug(model: string): string {
  return model
    .toLowerCase()
    .replace(/^.*\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Reasoning controls that keep Groq's reasoning models fast, by model family. */
function groqReasoning(model: string): Record<string, unknown> {
  if (model.includes('gpt-oss')) return { reasoning_effort: 'low', include_reasoning: false };
  if (model.includes('qwen')) return { reasoning_effort: 'none', reasoning_format: 'hidden' };
  return {};
}

interface ProviderSet {
  stt: SttProvider[];
  mt: MtProvider[];
  tts: TtsProvider[];
}

function buildProviders(keys: KeyStore, env: NodeJS.ProcessEnv, mock: boolean): ProviderSet {
  if (mock) {
    return { stt: [new MockSttProvider()], mt: [new MockMtProvider()], tts: [new MockTtsProvider()] };
  }

  const groqKey = () => keys.get('GROQ_API_KEY');
  const geminiKey = () => keys.get('GEMINI_API_KEY');
  const geminiModels = [...list(env.GEMINI_MODEL), ...DEFAULTS.geminiModels];
  const gemmaModels = [...list(env.GEMMA_MODEL), ...DEFAULTS.gemmaModels];
  const groqSttModels =
    list(env.GROQ_STT_MODELS).length > 0 ? list(env.GROQ_STT_MODELS) : DEFAULTS.groqSttModels;
  const groqMtModels = list(env.GROQ_MT_MODELS).length > 0 ? list(env.GROQ_MT_MODELS) : DEFAULTS.groqMtModels;

  const stt: SttProvider[] = [
    new GeminiAudioSttProvider({ getKey: geminiKey, models: geminiModels }),
    ...groqSttModels.map(
      (model) => new GroqWhisperProvider({ id: `groq-${slug(model)}`, model, getKey: groqKey }),
    ),
  ];

  const mt: MtProvider[] = [
    new GeminiMtProvider({ getKey: geminiKey, models: geminiModels }),
    new GemmaMtProvider({ getKey: geminiKey, models: gemmaModels }),
    ...groqMtModels.map(
      (model) =>
        new OpenAiCompatMtProvider({
          id: `groq-${slug(model)}`,
          vendor: 'Groq',
          getBaseUrl: () => 'https://api.groq.com/openai/v1',
          getModel: () => model,
          getKey: groqKey,
          keyName: 'GROQ_API_KEY',
          requiresKey: true,
          reasoning: groqReasoning(model),
          // Free tier: 30 requests/min but only 8,000 tokens/min, i.e. roughly 14 of our requests.
          requestsPerMinute: 14,
        }),
    ),
    new OpenAiCompatMtProvider({
      id: 'custom',
      vendor: 'Custom endpoint',
      getBaseUrl: () => env.OPENAI_COMPAT_BASE_URL?.trim() || undefined,
      getModel: () => env.OPENAI_COMPAT_MODEL?.trim() || undefined,
      getKey: () => keys.get('OPENAI_COMPAT_API_KEY'),
      keyName: 'OPENAI_COMPAT_API_KEY',
      // Local servers (Ollama, LM Studio) need no key; the endpoint decides.
      requiresKey: false,
      timeoutMs: 12_000,
    }),
    new MyMemoryProvider({ getEmail: () => env.MYMEMORY_EMAIL?.trim() || undefined }),
  ];

  const tts: TtsProvider[] = [
    new AzureTtsProvider({
      getKey: () => keys.get('AZURE_SPEECH_KEY'),
      getRegion: () => env.AZURE_SPEECH_REGION,
    }),
    // Node's WebSocket client does not pick up a proxy from the environment by itself.
    new EdgeTtsProvider({ proxyUrl: env.HTTPS_PROXY?.trim() || env.https_proxy?.trim() || undefined }),
  ];

  return { stt, mt, tts };
}

export interface ProviderSelection<P> {
  providers: P[];
  /** Ids from the configured list that match no provider (typos, retired ids). */
  unknown: string[];
}

/**
 * Apply an explicit provider list. The list is exclusive: only the listed providers are
 * used, in that order. This is what makes "translate locally only" or "never send audio to
 * provider X" a guarantee rather than a preference. Without a list, all providers are used
 * in their default order.
 */
export function selectProviders<P extends ProviderBase>(
  all: P[],
  order: string[] | undefined,
): ProviderSelection<P> {
  if (!order || order.length === 0) return { providers: all, unknown: [] };
  const providers: P[] = [];
  const unknown: string[] = [];
  for (const id of order) {
    const match = all.find((provider) => provider.id === id);
    if (!match) unknown.push(id);
    else if (!providers.includes(match)) providers.push(match);
  }
  return { providers, unknown };
}

export interface Services {
  readonly config: AppConfig;
  readonly keys: KeyStore;
  readonly chains: PipelineChains;
  /** Configuration problems worth showing at start-up (e.g. unknown provider ids). */
  readonly warnings: readonly string[];
  info(): ServerInfo;
  providerStatus(): Record<ProviderKind, ProviderStatus[]>;
  voices(): VoiceInfo[];
  /** Subscribe to provider health changes. Returns an unsubscribe function. */
  onStatusChange(listener: () => void): () => void;
  /** Send one small real request to every configured provider and report what came back. */
  diagnose(): Promise<DiagnosticsReport>;
}

/** A short burst of harmonics: enough for a recognizer to accept the request, without real speech. */
function diagnosticAudio(): Int16Array {
  const samples = new Int16Array(UTTERANCE_SAMPLE_RATE * 1.2);
  for (let i = 0; i < samples.length; i++) {
    const t = i / UTTERANCE_SAMPLE_RATE;
    const envelope = Math.sin(Math.PI * (i / samples.length));
    samples[i] = Math.round(
      (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 360 * t)) * 0.2 * envelope * 32767,
    );
  }
  return samples;
}

const DIAGNOSTIC_TIMEOUT_MS = 15_000;

async function probe(provider: AnyProvider): Promise<DiagnosticResult> {
  const base = { kind: provider.kind, id: provider.id, label: provider.label };
  if (!provider.isConfigured()) {
    return {
      ...base,
      outcome: 'skipped',
      ms: 0,
      detail: provider.requiresKey ? 'API key not set' : 'not configured',
    };
  }
  const signal = AbortSignal.timeout(DIAGNOSTIC_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    let detail: string;
    if (provider.kind === 'stt') {
      const result = await provider.transcribe({
        pcm: diagnosticAudio(),
        sampleRate: UTTERANCE_SAMPLE_RATE,
        language: 'de',
        hints: [],
        signal,
      });
      // The test tone is not speech; an empty transcript is the correct answer.
      detail = result.text
        ? `key and model accepted (heard: "${result.text.slice(0, 60)}")`
        : 'key and model accepted';
    } else if (provider.kind === 'mt') {
      const result = await provider.translate({
        text: 'Guten Morgen, können Sie mich gut hören?',
        sourceLang: 'de',
        targetLangs: ['ur', 'en'],
        formality: 'formal',
        glossary: [],
        meetingContext: '',
        history: [],
        fragment: false,
        signal,
      });
      detail = `${result.translations.ur ?? '—'} | ${result.translations.en ?? '—'}`;
    } else {
      const result = await provider.synthesize({
        text: 'Guten Morgen, das ist ein Test.',
        lang: 'de',
        voice: undefined,
        rate: 1,
        signal,
      });
      detail = `${Math.round(result.audio.byteLength / 1024)} kB of ${result.mime} (${result.voice})`;
    }
    return { ...base, outcome: 'ok', ms: Date.now() - startedAt, detail };
  } catch (error) {
    const detail = signal.aborted
      ? 'no answer within 15 s'
      : error instanceof Error
        ? error.message
        : String(error);
    return { ...base, outcome: 'failed', ms: Date.now() - startedAt, detail };
  }
}

export async function createServices(
  config: AppConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Services> {
  const keys = new KeyStore({ definitions: KEY_DEFINITIONS, env, dataDir: config.dataDir });
  await keys.load();

  const listeners = new Set<() => void>();
  let notifyTimer: ReturnType<typeof setTimeout> | undefined;
  // Several providers often change state together (a key was saved); coalesce the notifications.
  const notify = () => {
    if (notifyTimer) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = undefined;
      for (const listener of listeners) listener();
    }, 100);
    notifyTimer.unref?.();
  };

  const providers = buildProviders(keys, env, config.mock);
  const warnings: string[] = [];
  const chain = <P extends ProviderBase>(kind: ProviderKind, all: P[], variable: string) => {
    // The mock providers stand in for everything; a production provider list does not apply to them.
    const selection = selectProviders(all, config.mock ? undefined : config.providerOrder[kind]);
    if (selection.unknown.length > 0) {
      warnings.push(
        `${variable} names unknown provider(s) ${selection.unknown.join(', ')}. Known ids: ${all.map((p) => p.id).join(', ')}.`,
      );
    }
    return new FallbackChain(kind, selection.providers, { onStatusChange: notify });
  };
  const stt = chain('stt', providers.stt, 'STT_PROVIDERS');
  const mt = chain('mt', providers.mt, 'MT_PROVIDERS');
  const tts = chain('tts', providers.tts, 'TTS_PROVIDERS');

  // An explicit STT_PROVIDERS order is taken literally; otherwise prefer per language.
  const explicitSttOrder = Boolean(config.providerOrder.stt?.length);
  const sttRank = (provider: SttProvider, lang: LangCode): number => {
    if (explicitSttOrder) return 0;
    const index = STT_PREFERENCE[lang].indexOf(provider.id);
    return index === -1 ? STT_PREFERENCE[lang].length : index;
  };

  // New keys deserve a fresh start: forget "key rejected" states and cooldowns.
  keys.onChange(() => {
    stt.resetHealth();
    mt.resetHealth();
    tts.resetHealth();
  });

  const providerStatus = () => ({ stt: stt.status(), mt: mt.status(), tts: tts.status() });

  const voices = (): VoiceInfo[] => {
    // Offer the voices of the first usable voice provider; the catalogues of the others are identical or irrelevant.
    const active = tts.providers.find((provider) => provider.isConfigured()) ?? tts.providers[0];
    return active ? active.voices() : [];
  };

  let diagnosing: Promise<DiagnosticsReport> | undefined;

  return {
    config,
    keys,
    chains: { stt, mt, tts, sttRank },
    warnings,
    providerStatus,
    voices,
    info: () => ({
      name: 'tarjuman',
      version: pkg.version,
      protocol: PROTOCOL_VERSION,
      providers: providerStatus(),
      voices: voices(),
      keysWritable: config.keysWritable,
      authRequired: Boolean(config.accessToken),
    }),
    onStatusChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    diagnose: () => {
      // Diagnostics spend real quota: never run two at once.
      diagnosing ??= (async () => {
        const startedAt = Date.now();
        try {
          // Kinds in parallel, providers of one kind in sequence (several share a key and a rate limit).
          const perKind = await Promise.all(
            [stt.providers, mt.providers, tts.providers].map(async (group: readonly AnyProvider[]) => {
              const results: DiagnosticResult[] = [];
              for (const provider of group) results.push(await probe(provider));
              return results;
            }),
          );
          return { startedAt, results: perKind.flat() };
        } finally {
          diagnosing = undefined;
        }
      })();
      return diagnosing;
    },
  };
}
