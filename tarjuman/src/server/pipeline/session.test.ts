import { describe, expect, it } from 'vitest';

import { deferred, tonePcm, waitFor } from '../../../tests/unit/helpers';
import type { LangCode } from '../../shared/languages';
import {
  decodeBinaryFrame,
  type AudioUtteranceHeader,
  type ServerMessage,
  type SpeechChunkHeader,
} from '../../shared/protocol';
import { DEFAULT_SESSION_SETTINGS, type ChannelId, type SessionSettings } from '../../shared/settings';
import { FallbackChain } from '../providers/chain';
import {
  ProviderError,
  type MtProvider,
  type MtRequest,
  type MtResult,
  type SttProvider,
  type SttRequest,
  type SttResult,
  type TtsProvider,
  type TtsRequest,
} from '../providers/types';
import { InterpreterSession } from './session';

// ---------------------------------------------------------------------------------------
// Scripted providers
// ---------------------------------------------------------------------------------------

type SttScript = (request: SttRequest, call: number) => Promise<SttResult> | SttResult;
type MtScript = (request: MtRequest, call: number) => Promise<MtResult> | MtResult;
type TtsScript = (request: TtsRequest, call: number) => Promise<Uint8Array> | Uint8Array;

const SENTENCE: Record<LangCode, string> = {
  ur: 'ہم اگلے ہفتے نیا ورژن جاری کریں گے۔',
  de: 'Wir veröffentlichen nächste Woche die neue Version.',
  en: 'We will release the new version next week.',
};

function harness(
  scripts: { stt?: SttScript; mt?: MtScript; tts?: TtsScript } = {},
  settings?: SessionSettings,
) {
  const sttRequests: SttRequest[] = [];
  const mtRequests: MtRequest[] = [];
  const ttsRequests: TtsRequest[] = [];

  const stt: SttProvider = {
    id: 'stt',
    kind: 'stt',
    label: 'stt',
    requiresKey: false,
    timeoutMs: 5_000,
    isConfigured: () => true,
    supportsLanguage: () => true,
    transcribe: async (request) => {
      sttRequests.push(request);
      return scripts.stt
        ? scripts.stt(request, sttRequests.length - 1)
        : { text: SENTENCE[request.language] };
    },
  };
  const mt: MtProvider = {
    id: 'mt',
    kind: 'mt',
    label: 'mt',
    requiresKey: false,
    contextAware: true,
    timeoutMs: 5_000,
    isConfigured: () => true,
    translate: async (request) => {
      mtRequests.push(request);
      if (scripts.mt) return scripts.mt(request, mtRequests.length - 1);
      return { translations: Object.fromEntries(request.targetLangs.map((lang) => [lang, SENTENCE[lang]])) };
    },
  };
  const tts: TtsProvider = {
    id: 'tts',
    kind: 'tts',
    label: 'tts',
    requiresKey: false,
    timeoutMs: 5_000,
    isConfigured: () => true,
    supportsLanguage: () => true,
    voices: () => [],
    synthesize: async (request) => {
      ttsRequests.push(request);
      const audio = scripts.tts
        ? await scripts.tts(request, ttsRequests.length - 1)
        : new TextEncoder().encode(request.text);
      return { audio, mime: 'audio/mpeg', voice: request.voice ?? `default-${request.lang}` };
    },
  };

  const events: ServerMessage[] = [];
  const speech: { header: SpeechChunkHeader; text: string }[] = [];
  /** Everything in the order it was sent, as short labels: "transcript:u1", "speech:u1#0", ... */
  const order: string[] = [];

  const session = new InterpreterSession({
    chains: {
      stt: new FallbackChain('stt', [stt]),
      mt: new FallbackChain('mt', [mt]),
      tts: new FallbackChain('tts', [tts]),
      sttRank: () => 0,
    },
    logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    transport: {
      send: (message) => {
        events.push(message);
        order.push(
          'id' in message ? `${message.type.replace('utterance.', '')}:${message.id}` : message.type,
        );
      },
      sendBinary: (frame) => {
        const decoded = decodeBinaryFrame(frame);
        const header = decoded.header as SpeechChunkHeader;
        speech.push({ header, text: new TextDecoder().decode(decoded.payload) });
        order.push(`speech:${header.id}#${header.index}`);
      },
    },
  });
  session.updateSettings(settings ?? DEFAULT_SESSION_SETTINGS);

  // Four seconds by default: long enough for the sample sentences to be plausible speech.
  const audio = (
    id: string,
    channel: ChannelId = 'outgoing',
    overrides: Partial<AudioUtteranceHeader> = {},
    seconds = 4,
  ) => {
    const pcm = tonePcm(seconds);
    session.submitAudio(
      {
        type: 'utterance.audio',
        id,
        channel,
        sampleRate: 16_000,
        durationMs: seconds * 1000,
        endedAt: 0,
        forcedSplit: false,
        playbackLagMs: 0,
        ...overrides,
      },
      pcm,
    );
  };

  const of = <T extends ServerMessage['type']>(type: T) =>
    events.filter((event): event is Extract<ServerMessage, { type: T }> => event.type === type);

  return { session, events, speech, order, audio, of, sttRequests, mtRequests, ttsRequests };
}

describe('InterpreterSession', () => {
  it('interprets a spoken utterance: transcript, translation, speech, done', async () => {
    const h = harness();
    h.audio('u1');
    await h.session.idle();

    expect(h.order).toEqual(['transcript:u1', 'translation:u1', 'speech:u1#0', 'done:u1']);
    expect(h.of('utterance.transcript')[0]).toMatchObject({ lang: 'ur', text: SENTENCE.ur, provider: 'stt' });
    expect(h.of('utterance.translation')[0]?.translations).toEqual({ de: SENTENCE.de, en: SENTENCE.en });
    expect(h.speech[0]).toMatchObject({
      text: SENTENCE.de,
      header: { channel: 'outgoing', lang: 'de', index: 0, last: true, mime: 'audio/mpeg', provider: 'tts' },
    });
    const timings = h.of('utterance.done')[0]?.timings;
    expect(timings?.totalMs).toBeGreaterThanOrEqual(0);
    expect(timings?.sttMs).toBeGreaterThanOrEqual(0);
    expect(h.session.pending).toBe(0);
  });

  it('asks the recognizer for the channel language and passes the translation job along', async () => {
    const h = harness();
    h.audio('u1', 'incoming');
    await h.session.idle();
    const request = h.sttRequests[0]!;
    expect(request.language).toBe('de');
    expect(request.translate).toMatchObject({
      sourceLang: 'de',
      targetLangs: ['ur', 'en'],
      formality: 'formal',
    });
    expect(h.mtRequests[0]).toMatchObject({ sourceLang: 'de', targetLangs: ['ur', 'en'], text: SENTENCE.de });
    expect(h.ttsRequests[0]).toMatchObject({ lang: 'ur', text: SENTENCE.ur });
  });

  it('skips the translation step when the recognizer already translated', async () => {
    const h = harness({
      stt: () => ({ text: SENTENCE.ur, translations: { de: 'Vom Erkenner.', en: 'From the recognizer.' } }),
    });
    h.audio('u1');
    await h.session.idle();
    expect(h.mtRequests).toHaveLength(0);
    expect(h.of('utterance.translation')[0]).toMatchObject({
      provider: 'stt',
      translations: { de: 'Vom Erkenner.' },
    });
    expect(h.speech[0]?.text).toBe('Vom Erkenner.');
  });

  it('still translates when the recognizer returned only some of the languages', async () => {
    const h = harness({ stt: () => ({ text: SENTENCE.ur, translations: { de: 'Nur Deutsch.' } }) });
    h.audio('u1');
    await h.session.idle();
    expect(h.mtRequests).toHaveLength(1);
    expect(h.of('utterance.translation')[0]?.provider).toBe('mt');
  });

  it('interprets typed text without calling the recognizer', async () => {
    const h = harness();
    h.session.submitText('t1', 'outgoing', '  یہ ایک ٹیسٹ ہے  ');
    await h.session.idle();
    expect(h.sttRequests).toHaveLength(0);
    expect(h.order).toEqual(['transcript:t1', 'translation:t1', 'speech:t1#0', 'done:t1']);
    expect(h.of('utterance.transcript')[0]).toMatchObject({ text: 'یہ ایک ٹیسٹ ہے', provider: 'keyboard' });
  });

  it('takes typed text as written, brackets and all', async () => {
    const h = harness();
    h.session.submitText(
      't1',
      'incoming',
      'Bitte senden Sie die Rechnung (Nr. 4711) bis Freitag [dringend] an *Herrn Khan*.',
    );
    await h.session.idle();
    expect(h.mtRequests[0]?.text).toBe(
      'Bitte senden Sie die Rechnung (Nr. 4711) bis Freitag [dringend] an *Herrn Khan*.',
    );
  });

  it('drops audio that cannot contain speech before spending any quota', async () => {
    const h = harness();
    h.audio('short', 'outgoing', {}, 0.1);
    h.audio('long', 'outgoing', {}, 31);
    h.session.submitAudio(
      {
        type: 'utterance.audio',
        id: 'silent',
        channel: 'outgoing',
        sampleRate: 16_000,
        durationMs: 1000,
        endedAt: 0,
        forcedSplit: false,
        playbackLagMs: 0,
      },
      new Int16Array(16_000),
    );
    await h.session.idle();
    expect(h.sttRequests).toHaveLength(0);
    expect(h.of('utterance.dropped').map((d) => [d.id, d.reason])).toEqual([
      ['short', 'too_short'],
      ['long', 'too_long'],
      ['silent', 'no_speech'],
    ]);
  });

  it('rejects audio with the wrong sample rate', async () => {
    const h = harness();
    h.audio('u1', 'outgoing', { sampleRate: 48_000 });
    await h.session.idle();
    expect(h.of('utterance.error')[0]).toMatchObject({ id: 'u1', stage: 'stt', code: 'bad_request' });
    expect(h.sttRequests).toHaveLength(0);
  });

  it('drops recognition artefacts instead of speaking them', async () => {
    const h = harness({ stt: () => ({ text: 'Untertitel der Amara.org-Community' }) });
    h.audio('u1', 'incoming');
    await h.session.idle();
    expect(h.order).toEqual(['dropped:u1']);
    expect(h.of('utterance.dropped')[0]?.reason).toBe('hallucination');
    expect(h.mtRequests).toHaveLength(0);
    expect(h.speech).toHaveLength(0);
  });

  it('drops a transcript that is longer than the audio could possibly hold', async () => {
    const h = harness();
    h.audio('u1', 'incoming', {}, 1); // one second of audio, a 52-character sentence
    await h.session.idle();
    expect(h.order).toEqual(['dropped:u1']);
  });

  it('drops the utterance when the translator says there is nothing to translate', async () => {
    const h = harness({ mt: () => ({ translations: {}, skipped: true }) });
    h.audio('u1');
    await h.session.idle();
    expect(h.order).toEqual(['transcript:u1', 'dropped:u1']);
    expect(h.speech).toHaveLength(0);
  });

  it('produces captions but no audio when speaking is switched off', async () => {
    const settings: SessionSettings = structuredClone(DEFAULT_SESSION_SETTINGS);
    settings.channels.outgoing.speak = false;
    const h = harness({}, settings);
    h.audio('u1');
    await h.session.idle();
    expect(h.order).toEqual(['transcript:u1', 'translation:u1', 'done:u1']);
    expect(h.ttsRequests).toHaveLength(0);
  });

  it('keeps arrival order on a channel even when an earlier utterance is recognized later', async () => {
    const slow = deferred<SttResult>();
    const h = harness({
      stt: (_request, call) => (call === 0 ? slow.promise : { text: 'Zweiter Satz ist schnell erkannt.' }),
    });
    h.audio('u1', 'incoming');
    h.audio('u2', 'incoming');
    // Both are being recognized in parallel; nothing may be sent for u2 before u1.
    await waitFor(() => h.sttRequests.length === 2, 'both recognitions to start');
    expect(h.order).toEqual([]);
    slow.resolve({ text: 'Erster Satz hat lange gebraucht.' });
    await h.session.idle();
    // Every event exactly once ...
    expect([...h.order].sort()).toEqual(
      ['transcript', 'translation', 'speech', 'done']
        .flatMap((kind) => [
          `${kind}:u1${kind === 'speech' ? '#0' : ''}`,
          `${kind}:u2${kind === 'speech' ? '#0' : ''}`,
        ])
        .sort(),
    );
    // ... and, per kind, u1 before u2.
    for (const kind of ['transcript', 'translation', 'speech', 'done']) {
      const first = h.order.findIndex((entry) => entry.startsWith(`${kind}:u1`));
      const second = h.order.findIndex((entry) => entry.startsWith(`${kind}:u2`));
      expect(first).toBeGreaterThanOrEqual(0);
      expect(second).toBeGreaterThan(first);
    }
  });

  it('translates the next utterance while the previous one is still being synthesized', async () => {
    const voice = deferred<Uint8Array>();
    const h = harness({ tts: (_request, call) => (call === 0 ? voice.promise : new Uint8Array([2])) });
    h.audio('u1');
    h.audio('u2');
    await waitFor(() => h.order.includes('translation:u2'), 'the second translation');
    expect(h.order).not.toContain('speech:u1#0');
    voice.resolve(new Uint8Array([1]));
    await h.session.idle();
    expect(h.order.indexOf('speech:u1#0')).toBeLessThan(h.order.indexOf('speech:u2#0'));
  });

  it('does not let one channel hold up the other', async () => {
    const stuck = deferred<SttResult>();
    const h = harness({
      stt: (request) => (request.language === 'ur' ? stuck.promise : { text: SENTENCE.de }),
    });
    h.audio('mine', 'outgoing');
    h.audio('theirs', 'incoming');
    await waitFor(() => h.order.includes('done:theirs'), 'the incoming utterance to finish');
    expect(h.order.some((entry) => entry.endsWith(':mine'))).toBe(false);
    stuck.resolve({ text: SENTENCE.ur });
    await h.session.idle();
    expect(h.order).toContain('done:mine');
  });

  it('splits long translations into ordered chunks and marks the last one', async () => {
    const long = Array.from(
      { length: 8 },
      (_, i) => `Das ist der Satz Nummer ${i + 1} in einer längeren Antwort.`,
    ).join(' ');
    const h = harness({
      mt: (request) => ({ translations: Object.fromEntries(request.targetLangs.map((l) => [l, long])) }),
    });
    h.audio('u1');
    await h.session.idle();
    expect(h.speech.length).toBeGreaterThan(1);
    expect(h.speech.map((chunk) => chunk.header.index)).toEqual(h.speech.map((_, i) => i));
    expect(h.speech.map((chunk) => chunk.header.last)).toEqual(
      h.speech.map((_, i) => i === h.speech.length - 1),
    );
    expect(h.speech.map((chunk) => chunk.text).join(' ')).toBe(long);
  });

  it('reports a failure of each stage exactly once, with the stage and a useful code', async () => {
    const rateLimited = () => {
      throw new ProviderError('x', 'rate_limit', 'HTTP 429');
    };
    for (const stage of ['stt', 'mt', 'tts'] as const) {
      const h = harness({ [stage]: rateLimited });
      h.audio('u1');
      await h.session.idle();
      const errors = h.of('utterance.error');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ id: 'u1', stage, code: 'rate_limited' });
      expect(h.of('utterance.done')).toHaveLength(0);
      expect(h.session.pending).toBe(0);
      // What was achieved before the failure has still been delivered.
      expect(h.of('utterance.transcript')).toHaveLength(stage === 'stt' ? 0 : 1);
      expect(h.of('utterance.translation')).toHaveLength(stage === 'tts' ? 1 : 0);
    }
  });

  it('cancels an utterance in flight and tells the provider to stop', async () => {
    let aborted = false;
    const h = harness({
      stt: (request) =>
        new Promise<SttResult>((_resolve, reject) => {
          request.signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    });
    h.audio('u1');
    await waitFor(() => h.sttRequests.length === 1, 'recognition to start');
    h.session.cancel('u1');
    await h.session.idle();
    expect(aborted).toBe(true);
    expect(h.order).toEqual(['dropped:u1']);
    expect(h.of('utterance.dropped')[0]?.reason).toBe('cancelled');
  });

  it('refuses duplicate ids and floods', async () => {
    const never = deferred<SttResult>();
    const h = harness({ stt: () => never.promise });
    h.audio('u1');
    h.audio('u1');
    expect(h.of('utterance.error')[0]).toMatchObject({ id: 'u1', code: 'bad_request' });
    for (let i = 2; i <= 13; i++) h.audio(`u${i}`);
    const flood = h.of('utterance.error').filter((error) => error.code === 'rate_limited');
    expect(flood).toHaveLength(1);
    expect(flood[0]?.id).toBe('u13');
    h.session.close();
  });

  it('feeds earlier turns of both channels to the translator, until the context is reset', async () => {
    const h = harness();
    h.audio('u1', 'outgoing');
    await h.session.idle();
    h.audio('u2', 'incoming');
    await h.session.idle();
    expect(h.mtRequests[1]?.history).toEqual([{ speaker: 'me', lang: 'ur', text: SENTENCE.ur }]);
    h.audio('u3', 'outgoing');
    await h.session.idle();
    expect(h.mtRequests[2]?.history.map((turn) => turn.speaker)).toEqual(['me', 'them']);

    h.session.resetContext();
    h.audio('u4', 'outgoing');
    await h.session.idle();
    expect(h.mtRequests[3]?.history).toEqual([]);
  });

  it('applies settings (glossary, voice, speed-up when speech is queued) to later utterances', async () => {
    const h = harness();
    const settings: SessionSettings = structuredClone(DEFAULT_SESSION_SETTINGS);
    settings.glossary = [{ term: 'Tarjuman', translation: '' }];
    settings.channels.outgoing.voice = 'de-DE-ConradNeural';
    settings.formality = 'informal';
    h.session.updateSettings(settings);

    h.audio('u1', 'outgoing', { playbackLagMs: 6_000, forcedSplit: true });
    await h.session.idle();
    expect(h.sttRequests[0]?.hints).toEqual(['Tarjuman']);
    expect(h.mtRequests[0]).toMatchObject({
      formality: 'informal',
      fragment: true,
      glossary: settings.glossary,
    });
    expect(h.ttsRequests[0]).toMatchObject({ voice: 'de-DE-ConradNeural', rate: 1.2 });
  });

  it('sends nothing after it has been closed', async () => {
    const slow = deferred<SttResult>();
    const h = harness({ stt: () => slow.promise });
    h.audio('u1');
    h.session.close();
    slow.resolve({ text: SENTENCE.ur });
    await h.session.idle();
    h.audio('u2');
    expect(h.events).toEqual([]);
    expect(h.speech).toEqual([]);
  });
});
