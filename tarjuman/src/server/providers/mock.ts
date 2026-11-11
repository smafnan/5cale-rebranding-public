import { LANGUAGES, type LangCode } from '../../shared/languages';
import { pcm16ToWav, type VoiceInfo } from '../../shared/protocol';
import type {
  MtProvider,
  MtRequest,
  MtResult,
  SttProvider,
  SttRequest,
  SttResult,
  TtsProvider,
  TtsRequest,
  TtsResult,
} from './types';

/**
 * Offline stand-ins for every provider (`TARJUMAN_MOCK=1`).
 *
 * They make the whole product runnable without network access or API keys: for the
 * automated end-to-end tests, and for trying the audio routing before signing up for
 * anything. They do not translate; they produce recognisable placeholder output.
 */

const SAMPLE_SENTENCES: Record<LangCode, string[]> = {
  ur: ['السلام علیکم، کیا آپ مجھے سن سکتے ہیں؟', 'ہم اگلے ہفتے نیا ورژن جاری کریں گے۔', 'مجھے اس بارے میں ایک سوال ہے۔'],
  de: ['Guten Morgen, können Sie mich hören?', 'Wir veröffentlichen nächste Woche die neue Version.', 'Dazu habe ich eine Frage.'],
  en: ['Good morning, can you hear me?', 'We will release the new version next week.', 'I have a question about that.'],
};

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** "Recognizes" speech by cycling through fixed sample sentences in the requested language. */
export class MockSttProvider implements SttProvider {
  readonly id = 'mock-stt';
  readonly kind = 'stt' as const;
  readonly label = 'Mock recognizer (offline)';
  readonly requiresKey = false;
  readonly timeoutMs = 5_000;
  private counter = 0;

  constructor(private readonly latencyMs = 120) {}

  isConfigured(): boolean {
    return true;
  }

  supportsLanguage(): boolean {
    return true;
  }

  async transcribe(request: SttRequest): Promise<SttResult> {
    await delay(this.latencyMs, request.signal);
    const samples = SAMPLE_SENTENCES[request.language];
    const text = samples[this.counter++ % samples.length] ?? '';
    return { text, noSpeechProb: 0.01, avgLogProb: -0.2, compressionRatio: 1.2 };
  }
}

/**
 * "Translates" by returning a fixed sentence in each target language, tagged with the
 * source length so tests can tell results apart.
 */
export class MockMtProvider implements MtProvider {
  readonly id = 'mock-mt';
  readonly kind = 'mt' as const;
  readonly label = 'Mock translator (offline)';
  readonly requiresKey = false;
  readonly contextAware = true;
  readonly timeoutMs = 5_000;

  constructor(private readonly latencyMs = 80) {}

  isConfigured(): boolean {
    return true;
  }

  async translate(request: MtRequest): Promise<MtResult> {
    await delay(this.latencyMs, request.signal);
    const translations: Partial<Record<LangCode, string>> = {};
    const pick = request.text.length % 3;
    for (const lang of request.targetLangs) {
      translations[lang] = SAMPLE_SENTENCES[lang][pick] ?? SAMPLE_SENTENCES[lang][0] ?? '';
    }
    return { translations };
  }
}

const MOCK_SAMPLE_RATE = 24_000;

/** A short two-tone chime, so "speech" is audible and its length tracks the text length. */
export function synthesizeChime(text: string, rate: number, lang: LangCode): Uint8Array {
  const seconds = Math.min(4, Math.max(0.35, text.length / 22)) / Math.max(0.5, rate);
  const samples = Math.round(seconds * MOCK_SAMPLE_RATE);
  const pcm = new Int16Array(samples);
  // A different pitch per language makes the direction recognisable by ear.
  const base = lang === 'ur' ? 440 : lang === 'de' ? 554 : 659;
  for (let i = 0; i < samples; i++) {
    const t = i / MOCK_SAMPLE_RATE;
    const syllable = Math.floor(t * 5) % 2 === 0 ? base : base * 1.25;
    const fade = Math.min(1, i / 600, (samples - i) / 600);
    const tremolo = 0.6 + 0.4 * Math.sin(2 * Math.PI * 5 * t);
    pcm[i] = Math.round(Math.sin(2 * Math.PI * syllable * t) * 0.25 * fade * tremolo * 32767);
  }
  return pcm16ToWav(pcm, MOCK_SAMPLE_RATE);
}

/** "Speaks" a chime instead of words. */
export class MockTtsProvider implements TtsProvider {
  readonly id = 'mock-tts';
  readonly kind = 'tts' as const;
  readonly label = 'Mock voice (offline chime)';
  readonly requiresKey = false;
  readonly timeoutMs = 5_000;

  constructor(private readonly latencyMs = 60) {}

  isConfigured(): boolean {
    return true;
  }

  supportsLanguage(): boolean {
    return true;
  }

  voices(): VoiceInfo[] {
    return (Object.keys(LANGUAGES) as LangCode[]).map((lang) => ({
      id: `mock-${lang}`,
      provider: this.id,
      lang,
      locale: LANGUAGES[lang].locale,
      label: `Chime (${LANGUAGES[lang].name})`,
      gender: 'female' as const,
    }));
  }

  async synthesize(request: TtsRequest): Promise<TtsResult> {
    await delay(this.latencyMs, request.signal);
    return {
      audio: synthesizeChime(request.text, request.rate, request.lang),
      mime: 'audio/wav',
      voice: `mock-${request.lang}`,
    };
  }
}
