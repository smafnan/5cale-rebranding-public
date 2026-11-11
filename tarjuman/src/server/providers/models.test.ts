import { describe, expect, it } from 'vitest';

import {
  bodyOf,
  fakeFetch,
  jsonResponse,
  mtRequest,
  must,
  tonePcm,
  translationJob,
} from '../../../tests/unit/helpers';
import {
  buildGeminiBody,
  GeminiAudioSttProvider,
  GeminiMtProvider,
  GeminiNegotiator,
  GemmaMtProvider,
} from './gemini';
import { buildChatBody, OpenAiCompatMtProvider } from './mt/openaiCompat';
import { MyMemoryProvider } from './mt/myMemory';
import { buildWhisperPrompt, GroqWhisperProvider, summarizeSegments } from './stt/groqWhisper';
import { AzureTtsProvider, parseAzureCredentials } from './tts/azure';
import { resolveVoice, ssmlRate } from './tts/voices';
import { ProviderError } from './types';

const GERMAN = 'Wir veröffentlichen nächste Woche die neue Version.';
const ENGLISH = 'We will release the new version next week.';
const URDU = 'ہم اگلے ہفتے نیا ورژن جاری کریں گے۔';

const geminiAnswer = (payload: unknown, extra: Record<string, unknown> = {}) =>
  jsonResponse({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] }, finishReason: 'STOP' }],
    ...extra,
  });

async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

describe('Gemini', () => {
  it('sends the key in a header, never in the URL, with schema and minimal thinking', async () => {
    const { fetch, calls } = fakeFetch(() => geminiAnswer({ skip: false, en: ENGLISH, de: GERMAN }));
    const provider = new GeminiMtProvider({
      getKey: () => 'secret-key',
      models: ['model-a'],
      fetchImpl: fetch,
    });

    const result = await provider.translate(mtRequest());

    expect(result).toEqual({ translations: { de: GERMAN, en: ENGLISH }, skipped: false });
    const call = must(calls[0]);
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/model-a:generateContent');
    expect(call.url).not.toContain('secret-key');
    expect(call.headers.get('x-goog-api-key')).toBe('secret-key');
    const body = bodyOf(call) as { systemInstruction: unknown; generationConfig: Record<string, unknown> };
    expect(body.systemInstruction).toBeDefined();
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseJsonSchema).toBeDefined();
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' });
    expect(body.generationConfig).not.toHaveProperty('temperature');
  });

  it('builds the three request shapes', () => {
    const parts = { system: 'SYS', userParts: [{ text: 'USER' }], schema: { type: 'object' } };
    const full = buildGeminiBody({ shape: 'full', ...parts });
    const schema = buildGeminiBody({ shape: 'schema', ...parts });
    const bare = buildGeminiBody({ shape: 'bare', ...parts });
    expect(full.generationConfig).toHaveProperty('thinkingConfig');
    expect(schema.generationConfig).not.toHaveProperty('thinkingConfig');
    expect(schema.generationConfig).toHaveProperty('responseJsonSchema');
    expect(bare).not.toHaveProperty('systemInstruction');
    expect(bare.contents[0]?.parts).toEqual([{ text: 'SYS' }, { text: 'USER' }]);
    expect(bare.generationConfig).not.toHaveProperty('responseMimeType');
  });

  it('moves to the next model on 404 and to a plainer request on 400, and remembers both', async () => {
    const seen: string[] = [];
    const { fetch, calls } = fakeFetch((call) => {
      const model = /models\/([^:]+):/.exec(call.url)?.[1] ?? '';
      const config = (bodyOf(call).generationConfig ?? {}) as Record<string, unknown>;
      const shape = config.thinkingConfig ? 'full' : config.responseMimeType ? 'schema' : 'bare';
      seen.push(`${model}/${shape}`);
      if (model === 'retired')
        return jsonResponse({ error: { message: 'model not found' } }, { status: 404 });
      if (shape === 'full')
        return jsonResponse({ error: { message: 'thinking_level is not supported' } }, { status: 400 });
      return geminiAnswer({ skip: false, en: ENGLISH, de: GERMAN });
    });
    const provider = new GeminiMtProvider({
      getKey: () => 'k',
      models: ['retired', 'current'],
      fetchImpl: fetch,
    });

    await provider.translate(mtRequest());
    await provider.translate(mtRequest());

    expect(seen).toEqual(['retired/full', 'current/full', 'current/schema', 'current/schema']);
    expect(provider.label).toContain('current');
    expect(calls).toHaveLength(4);
  });

  it('advances once, not once per request, when several requests fail at the same time', async () => {
    const negotiator = new GeminiNegotiator(['retired', 'good', 'older'], 'full');
    const attempt = () =>
      negotiator.run(async (model) => {
        await Promise.resolve();
        if (model === 'retired')
          throw new ProviderError('p', 'bad_request', 'model not found', { status: 404 });
        return model;
      });
    expect(await Promise.all([attempt(), attempt(), attempt()])).toEqual(['good', 'good', 'good']);
    expect(negotiator.model).toBe('good');
  });

  it('keeps a request shape that has worked, even if a later request is rejected', async () => {
    const negotiator = new GeminiNegotiator(['m'], 'full');
    expect(await negotiator.run(async () => 'ok')).toBe('ok');
    await failure(
      negotiator.run(async () => {
        throw new ProviderError('p', 'bad_request', 'this one request was malformed', { status: 400 });
      }),
    );
    expect(negotiator.shape).toBe('full');
  });

  it('does not walk the ladder for errors that another shape cannot fix', async () => {
    const negotiator = new GeminiNegotiator(['a', 'b'], 'full');
    let calls = 0;
    const error = await failure(
      negotiator.run(async () => {
        calls += 1;
        throw new ProviderError('p', 'rate_limit', 'HTTP 429', { status: 429 });
      }),
    );
    expect(error.kind).toBe('rate_limit');
    expect(calls).toBe(1);
    expect(negotiator.model).toBe('a');
    expect(negotiator.shape).toBe('full');
  });

  it('ignores thought parts and rejects blocked, truncated and empty answers', async () => {
    const withThought = fakeFetch(() =>
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                { text: 'thinking...', thought: true },
                { text: JSON.stringify({ skip: false, en: ENGLISH, de: GERMAN }) },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      }),
    );
    const ok = new GeminiMtProvider({ getKey: () => 'k', models: ['m'], fetchImpl: withThought.fetch });
    expect((await ok.translate(mtRequest())).translations.de).toBe(GERMAN);

    const cases: [unknown, string][] = [
      [{ promptFeedback: { blockReason: 'SAFETY' } }, 'blocked'],
      [
        {
          candidates: [
            { content: { parts: [{ text: '{"skip": false, "en": "We w' }] }, finishReason: 'MAX_TOKENS' },
          ],
        },
        'MAX_TOKENS',
      ],
      [{ candidates: [] }, 'no text'],
    ];
    for (const [body, expected] of cases) {
      const { fetch } = fakeFetch(() => jsonResponse(body));
      const provider = new GeminiMtProvider({ getKey: () => 'k', models: ['m'], fetchImpl: fetch });
      const error = await failure(provider.translate(mtRequest()));
      expect(error.kind).toBe('bad_response');
      expect(error.message).toContain(expected);
    }
  });

  it('reads the retry delay Google puts in a 429 body', async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse(
        { error: { message: 'quota', status: 'RESOURCE_EXHAUSTED', details: [{ retryDelay: '23s' }] } },
        { status: 429 },
      ),
    );
    const provider = new GeminiMtProvider({ getKey: () => 'k', models: ['m'], fetchImpl: fetch });
    const error = await failure(provider.translate(mtRequest()));
    expect(error.kind).toBe('rate_limit');
    expect(error.retryAfterMs).toBe(23_000);
  });

  it("treats Google's HTTP 400 for an invalid key as an authentication failure, not a bad request", async () => {
    // Body as returned by the live API for a wrong key.
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse(
        {
          error: {
            code: 400,
            message: 'API key not valid. Please pass a valid API key.',
            status: 'INVALID_ARGUMENT',
            details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }],
          },
        },
        { status: 400 },
      ),
    );
    const provider = new GeminiMtProvider({ getKey: () => 'wrong', models: ['a', 'b'], fetchImpl: fetch });
    const error = await failure(provider.translate(mtRequest()));
    expect(error.kind).toBe('auth');
    // One request only: no walking down the request shapes because of a wrong key.
    expect(calls).toHaveLength(1);
  });

  it('is unconfigured without a key', async () => {
    const provider = new GemmaMtProvider({ getKey: () => undefined, models: ['m'] });
    expect(provider.isConfigured()).toBe(false);
    expect((await failure(provider.translate(mtRequest()))).kind).toBe('auth');
  });

  it('audio provider sends the utterance as inline WAV and returns transcript plus translations', async () => {
    const { fetch, calls } = fakeFetch(() =>
      geminiAnswer({ skip: false, transcript: URDU, en: ENGLISH, de: GERMAN }),
    );
    const provider = new GeminiAudioSttProvider({ getKey: () => 'k', models: ['m'], fetchImpl: fetch });

    const result = await provider.transcribe({
      pcm: tonePcm(1),
      sampleRate: 16_000,
      language: 'ur',
      hints: [],
      translate: translationJob(),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ text: URDU, translations: { de: GERMAN, en: ENGLISH } });
    const body = bodyOf(must(calls[0])) as {
      contents: { parts: { inlineData?: { mimeType: string; data: string } }[] }[];
    };
    const inline = must(body.contents[0]?.parts[0]?.inlineData);
    expect(inline.mimeType).toBe('audio/wav');
    expect(Buffer.from(inline.data, 'base64').subarray(0, 4).toString()).toBe('RIFF');
  });

  it('audio provider returns only the transcript without a translation job, and nothing for silence', async () => {
    const speech = fakeFetch(() => geminiAnswer({ skip: false, transcript: URDU, en: ENGLISH }));
    const provider = new GeminiAudioSttProvider({
      getKey: () => 'k',
      models: ['m'],
      fetchImpl: speech.fetch,
    });
    const request = {
      pcm: tonePcm(1),
      sampleRate: 16_000,
      language: 'ur' as const,
      hints: ['Tarjuman'],
      signal: new AbortController().signal,
    };
    expect(await provider.transcribe(request)).toEqual({ text: URDU, translations: undefined });

    const silence = fakeFetch(() => geminiAnswer({ skip: true, transcript: '', en: '' }));
    const quiet = new GeminiAudioSttProvider({ getKey: () => 'k', models: ['m'], fetchImpl: silence.fetch });
    expect(await quiet.transcribe(request)).toEqual({ text: '' });
  });
});

describe('Groq Whisper', () => {
  it('uploads a WAV with the language pinned and asks for confidence signals', async () => {
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse({
        text: ' Guten Morgen. ',
        segments: [
          { start: 0, end: 1, avg_logprob: -0.2, no_speech_prob: 0.02, compression_ratio: 1.1 },
          { start: 1, end: 4, avg_logprob: -0.6, no_speech_prob: 0.1, compression_ratio: 1.4 },
        ],
      }),
    );
    const provider = new GroqWhisperProvider({
      id: 'groq-x',
      model: 'whisper-large-v3',
      getKey: () => 'gsk_test',
      fetchImpl: fetch,
    });

    const result = await provider.transcribe({
      pcm: tonePcm(1),
      sampleRate: 16_000,
      language: 'de',
      hints: ['Tarjuman', 'Sprint'],
      signal: new AbortController().signal,
    });

    const call = must(calls[0]);
    expect(call.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(call.headers.get('authorization')).toBe('Bearer gsk_test');
    const form = call.init.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3');
    expect(form.get('language')).toBe('de');
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.get('temperature')).toBe('0');
    expect(String(form.get('prompt'))).toContain('Tarjuman, Sprint');
    const file = form.get('file') as File;
    expect(file.name).toBe('utterance.wav');
    expect(
      Buffer.from(await file.arrayBuffer())
        .subarray(0, 4)
        .toString(),
    ).toBe('RIFF');

    expect(result.text).toBe(' Guten Morgen. ');
    // Weighted by segment duration: (1 * -0.2 + 3 * -0.6) / 4
    expect(result.avgLogProb).toBeCloseTo(-0.5);
    expect(result.noSpeechProb).toBeCloseTo(0.08);
    expect(result.compressionRatio).toBe(1.4);
  });

  it('copes with a response that has no segments', () => {
    expect(summarizeSegments([])).toEqual({ compressionRatio: undefined });
  });

  it('keeps the prompt short however long the glossary is', () => {
    const prompt = buildWhisperPrompt(
      'ur',
      Array.from({ length: 200 }, (_, i) => `Fachbegriff${i}`),
    );
    expect(prompt.length).toBeLessThanOrEqual(420);
    expect(prompt.startsWith('یہ ایک کاروباری')).toBe(true);
  });

  it('classifies failures', async () => {
    const cases: [Response, string, number | undefined][] = [
      [jsonResponse({ error: { message: 'Invalid API Key' } }, { status: 401 }), 'auth', undefined],
      [
        jsonResponse({ error: { message: 'slow down' } }, { status: 429, headers: { 'retry-after': '7' } }),
        'rate_limit',
        7_000,
      ],
      [
        jsonResponse(
          { error: { message: 'slow down' } },
          { status: 429, headers: { 'retry-after-ms': '450' } },
        ),
        'rate_limit',
        450,
      ],
      [jsonResponse({ nothing: true }), 'bad_response', undefined],
    ];
    for (const [response, kind, retryAfterMs] of cases) {
      const { fetch } = fakeFetch(() => response);
      const provider = new GroqWhisperProvider({ id: 'g', model: 'm', getKey: () => 'k', fetchImpl: fetch });
      const error = await failure(
        provider.transcribe({
          pcm: tonePcm(1),
          sampleRate: 16_000,
          language: 'de',
          hints: [],
          signal: new AbortController().signal,
        }),
      );
      expect(error.kind).toBe(kind);
      expect(error.retryAfterMs).toBe(retryAfterMs);
    }
  });
});

describe('OpenAI-compatible translation', () => {
  const chatAnswer = (payload: unknown) =>
    jsonResponse({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: 'stop' }] });
  const options = (
    fetchImpl: typeof fetch,
    extra: Partial<ConstructorParameters<typeof OpenAiCompatMtProvider>[0]> = {},
  ) => ({
    id: 'groq-x',
    vendor: 'Groq',
    getBaseUrl: () => 'https://api.groq.com/openai/v1/',
    getModel: () => 'openai/gpt-oss-120b',
    getKey: () => 'gsk_test',
    keyName: 'GROQ_API_KEY',
    requiresKey: true,
    reasoning: { reasoning_effort: 'low', include_reasoning: false },
    fetchImpl,
    ...extra,
  });

  it('builds each request shape', () => {
    const args = ['m', 'SYS', 'USER', { type: 'object' }, { reasoning_effort: 'low' }] as const;
    const strict = buildChatBody('strict', ...args);
    expect(strict.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
    expect(strict.reasoning_effort).toBe('low');
    const json = buildChatBody('json', ...args);
    expect(json.response_format).toEqual({ type: 'json_object' });
    expect(json).not.toHaveProperty('reasoning_effort');
    const plain = buildChatBody('plain', ...args);
    expect(plain).not.toHaveProperty('response_format');
    expect((plain.messages as { role: string }[]).map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('steps down to a plainer request on 400 and stays there', async () => {
    const shapes: string[] = [];
    const { fetch, calls } = fakeFetch((call) => {
      const format = (bodyOf(call).response_format as { type?: string } | undefined)?.type ?? 'plain';
      shapes.push(format);
      if (format === 'json_schema')
        return jsonResponse({ error: { message: 'json_schema is not supported' } }, { status: 400 });
      return chatAnswer({ skip: false, en: ENGLISH, de: GERMAN });
    });
    const provider = new OpenAiCompatMtProvider(options(fetch));

    expect((await provider.translate(mtRequest())).translations.de).toBe(GERMAN);
    await provider.translate(mtRequest());

    expect(shapes).toEqual(['json_schema', 'json_object', 'json_object']);
    expect(must(calls[0]).url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(must(calls[0]).headers.get('authorization')).toBe('Bearer gsk_test');
  });

  it('does not step down for authentication, quota or server errors', async () => {
    for (const status of [401, 429, 500]) {
      const { fetch, calls } = fakeFetch(() => jsonResponse({ error: { message: 'nope' } }, { status }));
      const provider = new OpenAiCompatMtProvider(options(fetch));
      await failure(provider.translate(mtRequest()));
      expect(calls).toHaveLength(1);
    }
  });

  it('works without a key for local endpoints, and needs endpoint and model to be configured', async () => {
    const { fetch, calls } = fakeFetch(() => chatAnswer({ skip: false, en: ENGLISH, de: GERMAN }));
    const local = new OpenAiCompatMtProvider(
      options(fetch, {
        requiresKey: false,
        getKey: () => undefined,
        getBaseUrl: () => 'http://localhost:11434/v1',
        getModel: () => 'gemma',
      }),
    );
    expect(local.isConfigured()).toBe(true);
    await local.translate(mtRequest());
    expect(must(calls[0]).headers.has('authorization')).toBe(false);
    expect(must(calls[0]).url).toBe('http://localhost:11434/v1/chat/completions');

    expect(new OpenAiCompatMtProvider(options(fetch, { getModel: () => undefined })).isConfigured()).toBe(
      false,
    );
    expect(new OpenAiCompatMtProvider(options(fetch, { getKey: () => undefined })).isConfigured()).toBe(
      false,
    );
  });

  it('rejects an answer without content', async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }),
    );
    const error = await failure(new OpenAiCompatMtProvider(options(fetch)).translate(mtRequest()));
    expect(error.kind).toBe('bad_response');
    expect(error.message).toContain('length');
  });
});

describe('MyMemory', () => {
  const request = () => mtRequest({ sourceLang: 'de', targetLangs: ['ur', 'en'], text: 'Guten Morgen.' });

  it('asks once per target language and passes the contact e-mail', async () => {
    const { fetch, calls } = fakeFetch((call) => {
      const pair = new URL(call.url).searchParams.get('langpair');
      return jsonResponse({
        responseStatus: 200,
        responseData: { translatedText: pair === 'de|ur' ? 'صبح بخیر۔' : 'Good morning.' },
      });
    });
    const provider = new MyMemoryProvider({ getEmail: () => 'team@example.org', fetchImpl: fetch });

    expect(await provider.translate(request())).toEqual({
      translations: { ur: 'صبح بخیر۔', en: 'Good morning.' },
    });
    expect(calls.map((c) => new URL(c.url).searchParams.get('langpair')).sort()).toEqual(['de|en', 'de|ur']);
    expect(new URL(must(calls[0]).url).searchParams.get('de')).toBe('team@example.org');
    expect(must(calls[0]).init.method).toBe('GET');
  });

  it('does not mistake a translation that mentions a limit for a used-up quota, and tidies the text', async () => {
    const { fetch } = fakeFetch((call) => {
      const pair = new URL(call.url).searchParams.get('langpair');
      return jsonResponse({
        responseStatus: 200,
        quotaFinished: false,
        responseData: {
          translatedText:
            pair === 'ur|de' ? '"Das Tempolimit liegt bei 50.' : 'The speed limit isn&#39;t 50. ',
        },
      });
    });
    const provider = new MyMemoryProvider({ getEmail: () => undefined, fetchImpl: fetch });
    const result = await provider.translate(
      mtRequest({ sourceLang: 'ur', targetLangs: ['de', 'en'], text: 'رفتار کی حد 50 ہے۔' }),
    );
    expect(result.translations).toEqual({
      de: 'Das Tempolimit liegt bei 50.',
      en: "The speed limit isn't 50.",
    });
  });

  it('recognises a used-up quota, a wrong-script answer and over-long text', async () => {
    const quota = fakeFetch(() =>
      jsonResponse({
        responseStatus: 429,
        responseData: {
          translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY',
        },
      }),
    );
    expect(
      (
        await failure(
          new MyMemoryProvider({ getEmail: () => undefined, fetchImpl: quota.fetch }).translate(request()),
        )
      ).kind,
    ).toBe('rate_limit');

    const latin = fakeFetch(() =>
      jsonResponse({ responseStatus: 200, responseData: { translatedText: 'Good morning.' } }),
    );
    expect(
      (
        await failure(
          new MyMemoryProvider({ getEmail: () => undefined, fetchImpl: latin.fetch }).translate(request()),
        )
      ).kind,
    ).toBe('bad_response');

    const none = fakeFetch(() => jsonResponse({}));
    const tooLong = mtRequest({ sourceLang: 'de', targetLangs: ['en'], text: 'Wort '.repeat(120) });
    expect(
      (
        await failure(
          new MyMemoryProvider({ getEmail: () => undefined, fetchImpl: none.fetch }).translate(tooLong),
        )
      ).kind,
    ).toBe('bad_request');
    expect(none.calls).toHaveLength(0);
  });
});

describe('Azure voices', () => {
  it('accepts region:key or a key plus a region', () => {
    expect(parseAzureCredentials('westeurope:abc123', undefined)).toEqual({
      region: 'westeurope',
      key: 'abc123',
    });
    expect(parseAzureCredentials('abc123', 'GermanyWestCentral')).toEqual({
      region: 'germanywestcentral',
      key: 'abc123',
    });
    expect(parseAzureCredentials('abc123', undefined)).toBeUndefined();
    expect(parseAzureCredentials('bad region:abc', undefined)).toBeUndefined();
    expect(parseAzureCredentials(undefined, 'westeurope')).toBeUndefined();
  });

  it('requests MP3 from the regional endpoint with escaped SSML', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const provider = new AzureTtsProvider({
      getKey: () => 'westeurope:secret',
      getRegion: () => undefined,
      fetchImpl: fetch,
    });
    expect(provider.isConfigured()).toBe(true);

    const result = await provider.synthesize({
      text: 'A & B',
      lang: 'ur',
      voice: 'nonsense',
      rate: 0.9,
      signal: new AbortController().signal,
    });

    expect([...result.audio]).toEqual([1, 2, 3]);
    expect(result.voice).toBe('ur-PK-UzmaNeural');
    const call = must(calls[0]);
    expect(call.url).toBe('https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1');
    expect(call.headers.get('ocp-apim-subscription-key')).toBe('secret');
    expect(call.headers.get('x-microsoft-outputformat')).toBe('audio-24khz-48kbitrate-mono-mp3');
    expect(call.text).toContain("<voice name='ur-PK-UzmaNeural'>");
    expect(call.text).toContain("rate='-10%'");
    expect(call.text).toContain('A &amp; B');
  });

  it('picks voices and rates safely', () => {
    expect(resolveVoice('de', 'de-DE-ConradNeural').id).toBe('de-DE-ConradNeural');
    expect(resolveVoice('de', 'ur-PK-AsadNeural').id).toBe('de-DE-KatjaNeural');
    expect(resolveVoice('en', undefined).lang).toBe('en');
    expect(ssmlRate(1)).toBe('+0%');
    expect(ssmlRate(1.25)).toBe('+25%');
    expect(ssmlRate(0.7)).toBe('-30%');
    expect(ssmlRate(9)).toBe('+100%');
  });
});
