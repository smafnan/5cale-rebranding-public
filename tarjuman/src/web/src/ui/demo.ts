import type { DiagnosticsReport, KeysResponse } from '../../../shared/api';
import type { ProviderStatus, ServerInfo } from '../../../shared/protocol';
import {
  dismissNotice,
  initialChannelRuntime,
  mergeDeep,
  sanitizeLocalSettings,
  useAppStore,
} from '../state/store';
import type { AppController, TranscriptEntry } from '../state/types';
import { installStandInController } from './controller';

/**
 * Demo mode (`?demo=1`): the interface filled with realistic sample data and an offline
 * stand-in for the engine. Nothing touches the network, the microphone or saved settings.
 * Used for screenshots, visual tests and for looking at the interface without a server.
 *
 * This is the only UI module that writes to the store.
 */

export function isDemo(): boolean {
  return new URLSearchParams(globalThis.location?.search ?? '').get('demo') === '1';
}

function provider(
  kind: ProviderStatus['kind'],
  order: number,
  id: string,
  label: string,
  state: ProviderStatus['state'],
): ProviderStatus {
  return {
    id,
    kind,
    label,
    order,
    state,
    requiresKey: state !== 'ready' || kind !== 'tts',
    ...(state === 'unconfigured' ? { detail: 'API key not set' } : {}),
    ...(state === 'cooldown'
      ? { detail: 'HTTP 429 — rate limit reached', cooldownUntil: Date.now() + 42_000 }
      : {}),
  };
}

const SERVER: ServerInfo = {
  name: 'tarjuman',
  version: '0.1.0',
  protocol: 1,
  keysWritable: true,
  authRequired: false,
  providers: {
    stt: [
      provider('stt', 0, 'gemini-audio', 'Google · gemini-3.5-flash-lite (audio)', 'ready'),
      provider('stt', 1, 'groq-whisper-large-v3', 'Groq · whisper-large-v3', 'ready'),
      provider('stt', 2, 'groq-whisper-large-v3-turbo', 'Groq · whisper-large-v3-turbo', 'ready'),
    ],
    mt: [
      provider('mt', 0, 'gemini-flash-lite', 'Google · gemini-3.5-flash-lite', 'cooldown'),
      provider('mt', 1, 'groq-gpt-oss-120b', 'Groq · openai/gpt-oss-120b', 'ready'),
      provider('mt', 2, 'mymemory', 'MyMemory (no key, basic quality)', 'ready'),
    ],
    tts: [
      provider('tts', 0, 'azure', 'Azure AI Speech neural voices', 'unconfigured'),
      provider('tts', 1, 'edge', 'Microsoft Edge neural voices (no key)', 'ready'),
    ],
  },
  voices: [
    {
      id: 'ur-PK-UzmaNeural',
      provider: 'edge',
      lang: 'ur',
      locale: 'ur-PK',
      label: 'Uzma (Pakistan)',
      gender: 'female',
    },
    {
      id: 'ur-PK-AsadNeural',
      provider: 'edge',
      lang: 'ur',
      locale: 'ur-PK',
      label: 'Asad (Pakistan)',
      gender: 'male',
    },
    {
      id: 'de-DE-KatjaNeural',
      provider: 'edge',
      lang: 'de',
      locale: 'de-DE',
      label: 'Katja (Germany)',
      gender: 'female',
    },
    {
      id: 'de-DE-ConradNeural',
      provider: 'edge',
      lang: 'de',
      locale: 'de-DE',
      label: 'Conrad (Germany)',
      gender: 'male',
    },
    {
      id: 'en-US-AvaMultilingualNeural',
      provider: 'edge',
      lang: 'en',
      locale: 'en-US',
      label: 'Ava (US)',
      gender: 'female',
    },
  ],
};

function entry(index: number, fields: Partial<TranscriptEntry>): TranscriptEntry {
  const outgoing = fields.channel !== 'incoming';
  return {
    id: `demo${index}`,
    channel: 'outgoing',
    createdAt: Date.now() - (9 - index) * 21_000,
    typed: false,
    status: 'done',
    sourceLang: outgoing ? 'ur' : 'de',
    targetLang: outgoing ? 'de' : 'ur',
    sourceText: null,
    translations: {},
    audioMs: 4200,
    latencyMs: 1900,
    timings: { sttMs: 620, mtMs: 480, ttsFirstChunkMs: 410, ttsMs: 900, totalMs: 2000 },
    providers: { stt: 'gemini-audio', mt: 'gemini-audio', tts: 'edge' },
    dropReason: null,
    error: null,
    ...fields,
  };
}

const TRANSCRIPT: TranscriptEntry[] = [
  entry(1, {
    channel: 'incoming',
    sourceText: 'Guten Morgen zusammen. Können wir mit dem Stand des aktuellen Sprints anfangen?',
    translations: {
      ur: 'سب کو صبح بخیر۔ کیا ہم موجودہ اسپرنٹ کی صورتحال سے شروع کر سکتے ہیں؟',
      en: 'Good morning, everyone. Can we start with the status of the current sprint?',
    },
    latencyMs: 2100,
  }),
  entry(2, {
    sourceText: 'جی بالکل۔ ہم نے اس ہفتے payment module کا کام مکمل کر لیا ہے اور testing جاری ہے۔',
    translations: {
      de: 'Ja, natürlich. Wir haben diese Woche die Arbeit am Zahlungsmodul abgeschlossen, und die Tests laufen.',
      en: 'Yes, of course. We finished the work on the payment module this week, and testing is in progress.',
    },
    latencyMs: 1700,
  }),
  entry(3, {
    channel: 'incoming',
    sourceText: 'Sehr gut. Gibt es noch offene Fehler, die das Release am Freitag gefährden könnten?',
    translations: {
      ur: 'بہت خوب۔ کیا کوئی ایسی خرابیاں باقی ہیں جو جمعے کی ریلیز کو خطرے میں ڈال سکتی ہیں؟',
      en: 'Very good. Are there any open bugs that could put Friday’s release at risk?',
    },
    latencyMs: 1800,
  }),
  entry(4, {
    sourceText: 'دو چھوٹے bugs باقی ہیں، لیکن وہ کل تک ٹھیک ہو جائیں گے۔',
    translations: {
      de: 'Es sind noch zwei kleine Fehler offen, aber sie werden bis morgen behoben sein.',
      en: 'Two small bugs remain, but they will be fixed by tomorrow.',
    },
    latencyMs: 4600,
    error: 'Voice unavailable: Edge voice service: connection closed before the audio was complete',
  }),
  entry(5, {
    status: 'dropped',
    dropReason: 'hallucination',
    sourceText: 'Untertitel der Amara.org-Community',
    channel: 'incoming',
  }),
  entry(6, {
    typed: true,
    sourceText: 'کیا ہم ریلیز کے بعد ایک مختصر میٹنگ رکھ سکتے ہیں؟',
    translations: {
      de: 'Können wir nach dem Release ein kurzes Meeting ansetzen?',
      en: 'Can we schedule a short meeting after the release?',
    },
    audioMs: 0,
    latencyMs: 1100,
    providers: { mt: 'groq-gpt-oss-120b', tts: 'edge' },
  }),
  entry(7, {
    channel: 'incoming',
    status: 'error',
    sourceText: 'Ja, das passt mir gut.',
    error:
      'Translation failed: groq-gpt-oss-120b: HTTP 429 — rate limit reached. The free-tier limit was reached; try again in a moment.',
    latencyMs: null,
  }),
  entry(8, {
    channel: 'incoming',
    status: 'speaking',
    sourceText: 'Dann sehen wir uns am Montag um zehn Uhr. Vielen Dank für die gute Arbeit.',
    translations: {
      ur: 'تو پھر ہم پیر کو دس بجے ملتے ہیں۔ اچھے کام کے لیے بہت شکریہ۔',
      en: 'Then we will see each other on Monday at ten. Thank you very much for the good work.',
    },
    latencyMs: 1600,
  }),
  entry(9, { status: 'transcribing', latencyMs: null, timings: null, providers: {} }),
];

const KEYS: KeysResponse = {
  writable: true,
  info: SERVER,
  keys: [
    {
      name: 'GROQ_API_KEY',
      label: 'Groq',
      description:
        'Speech recognition (Whisper large-v3) and fast translation models. Free tier, no credit card.',
      signupUrl: 'https://console.groq.com/keys',
      set: true,
      source: 'file',
      hint: 'gsk_…x9Qd',
      recommended: true,
    },
    {
      name: 'GEMINI_API_KEY',
      label: 'Google AI Studio (Gemini)',
      description:
        'Most accurate Urdu: hears the audio and translates in one step. Free tier, no credit card.',
      signupUrl: 'https://aistudio.google.com/apikey',
      set: true,
      source: 'env',
      hint: 'AIza…4f2c',
      recommended: true,
    },
    {
      name: 'AZURE_SPEECH_KEY',
      label: 'Azure AI Speech (optional)',
      description: 'Official Microsoft neural voices. Enter as region:key.',
      signupUrl: 'https://portal.azure.com/',
      set: false,
      source: null,
      hint: null,
      recommended: false,
    },
  ],
};

const DIAGNOSTICS: DiagnosticsReport = {
  startedAt: Date.now(),
  results: [
    {
      kind: 'stt',
      id: 'gemini-audio',
      label: 'Google · gemini-3.5-flash-lite (audio)',
      outcome: 'ok',
      ms: 912,
      detail: 'key and model accepted',
    },
    {
      kind: 'stt',
      id: 'groq-whisper-large-v3',
      label: 'Groq · whisper-large-v3',
      outcome: 'ok',
      ms: 431,
      detail: 'key and model accepted',
    },
    {
      kind: 'mt',
      id: 'groq-gpt-oss-120b',
      label: 'Groq · openai/gpt-oss-120b',
      outcome: 'ok',
      ms: 688,
      detail: 'صبح بخیر، کیا آپ مجھے اچھی طرح سن سکتے ہیں؟ | Good morning, can you hear me well?',
    },
    {
      kind: 'tts',
      id: 'azure',
      label: 'Azure AI Speech neural voices',
      outcome: 'skipped',
      ms: 0,
      detail: 'API key not set',
    },
    {
      kind: 'tts',
      id: 'edge',
      label: 'Microsoft Edge neural voices (no key)',
      outcome: 'failed',
      ms: 6004,
      detail: 'Edge voice service: handshake rejected with HTTP 403',
    },
  ],
};

/** An engine that only edits the store, so controls respond without doing anything real. */
function standIn(): AppController {
  const nothing = () => undefined;
  const later = async () => undefined;
  return {
    init: later,
    startChannel: later,
    stopChannel: nothing,
    setPushToTalk: (held) =>
      useAppStore.setState((state) => ({
        channels: { ...state.channels, outgoing: { ...state.channels.outgoing, pttHeld: held } },
      })),
    sendText: nothing,
    updateSettings: (patch) =>
      useAppStore.setState((state) => ({
        settings: sanitizeLocalSettings(mergeDeep(state.settings, patch)),
      })),
    swapLanguages: nothing,
    unlockDeviceLabels: later,
    refreshDevices: later,
    flushPlayback: nothing,
    playTestPhrase: later,
    clearTranscript: () => useAppStore.setState({ transcript: [] }),
    exportTranscript: nothing,
    resetContext: nothing,
    getKeys: async () => KEYS,
    saveKeys: async () => KEYS,
    runDiagnostics: async () => DIAGNOSTICS,
    dismissNotice,
  };
}

export function loadDemo(): void {
  installStandInController(standIn());
  useAppStore.setState((state) => ({
    settings: sanitizeLocalSettings(
      mergeDeep(state.settings, { outgoing: { sinkId: 'cable-in' }, incoming: { sinkId: 'headset-out' } }),
    ),
    connection: 'connected',
    server: SERVER,
    providers: SERVER.providers,
    channels: {
      outgoing: {
        ...initialChannelRuntime(),
        capture: 'capturing',
        sourceLabel: 'Headset Microphone (Jabra Evolve2 65)',
        speaking: true,
        level: 0.62,
        pending: 1,
        sinkLabel: 'CABLE Input (VB-Audio Virtual Cable)',
      },
      incoming: {
        ...initialChannelRuntime(),
        capture: 'capturing',
        sourceLabel: 'Browser tab audio',
        level: 0.18,
        playing: true,
        queueMs: 3400,
        sinkLabel: 'Headphones (Jabra Evolve2 65)',
      },
    },
    transcript: TRANSCRIPT,
    devices: {
      inputs: [
        { deviceId: 'headset-in', label: 'Headset Microphone (Jabra Evolve2 65)', virtual: false },
        { deviceId: 'cable-out', label: 'CABLE Output (VB-Audio Virtual Cable)', virtual: true },
      ],
      outputs: [
        { deviceId: 'headset-out', label: 'Headphones (Jabra Evolve2 65)', virtual: false },
        { deviceId: 'speakers', label: 'Speakers (Realtek(R) Audio)', virtual: false },
        { deviceId: 'cable-in', label: 'CABLE Input (VB-Audio Virtual Cable)', virtual: true },
      ],
      labelsAvailable: true,
      canChooseOutput: true,
      canCaptureDisplayAudio: true,
    },
    notices: [
      {
        id: 'demo-notice',
        level: 'info',
        message: 'Playing a test phrase on: CABLE Input (VB-Audio Virtual Cable)',
        at: Date.now(),
      },
    ],
  }));
}
