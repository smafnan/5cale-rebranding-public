import { describe, expect, it } from 'vitest';

import { translationJob } from '../../../../tests/unit/helpers';
import { ProviderError } from '../types';
import {
  answerJsonSchema,
  answerOrder,
  buildSystemPrompt,
  buildUserPrompt,
  looksLikeLanguage,
  parseInterpreterAnswer,
  plausibleTranscript,
} from './prompt';

const URDU = 'ہم اگلے ہفتے نیا ورژن جاری کریں گے۔';
const GERMAN = 'Wir veröffentlichen nächste Woche die neue Version.';
const ENGLISH = 'We will release the new version next week.';

function parse(
  raw: string,
  options: { withTranscript?: boolean; job?: ReturnType<typeof translationJob> } = {},
) {
  return parseInterpreterAnswer('test', raw, options.job ?? translationJob(), {
    withTranscript: options.withTranscript ?? false,
    sourceText: URDU,
  });
}

function badResponse(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe('bad_response');
    return (error as ProviderError).message;
  }
  throw new Error('expected a bad_response error');
}

describe('interpreter prompt', () => {
  it('names the languages, the register and the scripts', () => {
    const formal = buildSystemPrompt(translationJob(), 'text');
    expect(formal).toContain('from Urdu into German and English');
    expect(formal).toContain('"Sie"');
    expect(formal).toContain('"آپ"');
    expect(formal).toContain('never in Roman Urdu or Devanagari');
    expect(formal).toContain('{"skip": boolean, "en": string, "de": string}');

    const informal = buildSystemPrompt(translationJob({ formality: 'informal' }), 'text');
    expect(informal).toContain('"du"');
    expect(informal).not.toContain('"Sie"');
  });

  it('asks for a transcript first in audio mode', () => {
    const prompt = buildSystemPrompt(
      translationJob({ sourceLang: 'de', targetLangs: ['ur', 'en'] }),
      'audio',
    );
    expect(prompt).toContain('First transcribe it verbatim');
    expect(prompt).toContain('{"skip": boolean, "transcript": string, "en": string, "ur": string}');
  });

  it('puts English first in the answer, then the spoken language', () => {
    expect(answerOrder(['de', 'en'])).toEqual(['en', 'de']);
    expect(answerOrder(['ur'])).toEqual(['ur']);
    const schema = answerJsonSchema(translationJob(), true) as {
      required: string[];
      additionalProperties: boolean;
    };
    expect(schema.required).toEqual(['skip', 'transcript', 'en', 'de']);
    expect(schema.additionalProperties).toBe(false);
  });

  it('adds context, glossary and the cut-off marker to the user message', () => {
    const user = buildUserPrompt(
      translationJob({
        meetingContext: 'Weekly planning call',
        glossary: [
          { term: 'Tarjuman', translation: '' },
          { term: 'sprint', translation: 'Sprint' },
        ],
        history: [{ speaker: 'them', lang: 'de', text: 'Guten Morgen.' }],
        fragment: true,
      }),
      URDU,
    );
    expect(user).toContain('Meeting: Weekly planning call');
    expect(user).toContain('- Tarjuman (keep unchanged)');
    expect(user).toContain('- sprint => Sprint');
    expect(user).toContain('[Speaker B, German] Guten Morgen.');
    expect(user).toContain('Utterance (Urdu, cut off mid-sentence):');
    expect(user.endsWith(`<utterance>${URDU}</utterance>`)).toBe(true);
  });

  it('leaves out empty sections', () => {
    expect(buildUserPrompt(translationJob(), URDU)).toBe(`Utterance (Urdu):\n<utterance>${URDU}</utterance>`);
  });
});

describe('parseInterpreterAnswer', () => {
  const good = JSON.stringify({ skip: false, en: ENGLISH, de: GERMAN });

  it('reads clean JSON, fenced JSON and JSON wrapped in prose', () => {
    for (const raw of [
      good,
      '```json\n' + good + '\n```',
      `Here is the translation:\n${good}\nHope this helps.`,
    ]) {
      expect(parse(raw)).toEqual({ skip: false, transcript: '', translations: { de: GERMAN, en: ENGLISH } });
    }
  });

  it('honours skip', () => {
    expect(parse('{"skip": true, "en": "", "de": ""}')).toEqual({
      skip: true,
      transcript: '',
      translations: {},
    });
  });

  it('rejects answers that are not JSON objects', () => {
    expect(badResponse(() => parse('Sorry, I cannot do that.'))).toContain('JSON');
    expect(badResponse(() => parse('[1, 2]'))).toContain('JSON');
  });

  it('rejects a missing language', () => {
    expect(badResponse(() => parse(JSON.stringify({ skip: false, en: ENGLISH })))).toContain('German');
  });

  it('rejects an empty answer in text mode but treats it as "no speech" in audio mode', () => {
    expect(badResponse(() => parse('{"skip": false, "en": "", "de": ""}'))).toContain('no translation');
    expect(
      parse('{"skip": false, "transcript": "", "en": "", "de": ""}', { withTranscript: true }).skip,
    ).toBe(true);
  });

  it('rejects translations in the wrong script', () => {
    const toUrdu = translationJob({ sourceLang: 'de', targetLangs: ['ur', 'en'] });
    expect(
      badResponse(() =>
        parse(JSON.stringify({ skip: false, en: ENGLISH, ur: 'Hum agle hafte naya version jari karenge.' }), {
          job: toUrdu,
        }),
      ),
    ).toContain('wrong script');
    expect(
      badResponse(() =>
        parse(JSON.stringify({ skip: false, en: ENGLISH, ur: 'हम अगले हफ्ते नया संस्करण जारी करेंगे।' }), {
          job: toUrdu,
        }),
      ),
    ).toContain('wrong script');
    expect(badResponse(() => parse(JSON.stringify({ skip: false, en: ENGLISH, de: URDU })))).toContain(
      'wrong script',
    );
  });

  it('rejects a rambling answer', () => {
    const rambling = `${GERMAN} `.repeat(12);
    expect(badResponse(() => parse(JSON.stringify({ skip: false, en: ENGLISH, de: rambling })))).toContain(
      'implausibly long',
    );
  });

  it('requires a transcript in the source script in audio mode', () => {
    const answer = (transcript: string) =>
      JSON.stringify({ skip: false, transcript, en: ENGLISH, de: GERMAN });
    expect(parse(answer(URDU), { withTranscript: true }).transcript).toBe(URDU);
    expect(badResponse(() => parse(answer(''), { withTranscript: true }))).toContain('without a transcript');
    expect(badResponse(() => parse(answer('हम अगले हफ्ते'), { withTranscript: true }))).toContain(
      'Urdu script',
    );
  });
});

describe('plausibleTranscript', () => {
  it('accepts code-switched speech, which is what the prompt asks the model to write down', () => {
    expect(plausibleTranscript('Next week Monday کو deployment ہے', 'ur')).toBe(true);
    expect(plausibleTranscript('Yes, the deployment is done.', 'ur')).toBe(true);
    expect(plausibleTranscript('Wir machen das morgen, inshallah (ان شاء اللہ).', 'de')).toBe(true);
  });

  it('rejects output that cannot be a transcript of that language', () => {
    expect(plausibleTranscript('हम अगले हफ्ते मिलेंगे', 'ur')).toBe(false);
    expect(plausibleTranscript('ہم اگلے ہفتے ملیں گے', 'de')).toBe(false);
  });

  it('lets a mostly-English Urdu utterance through the audio answer parser', () => {
    const raw = JSON.stringify({
      skip: false,
      transcript: 'Next week Monday کو deployment ہے',
      en: 'The deployment is next Monday.',
      de: 'Das Deployment ist nächsten Montag.',
    });
    expect(
      parseInterpreterAnswer('test', raw, translationJob(), { withTranscript: true }).transcript,
    ).toContain('deployment');
  });
});

describe('looksLikeLanguage', () => {
  it('accepts Urdu with English terms mixed in, and numbers on their own', () => {
    expect(looksLikeLanguage('ہم نے payment module کا کام مکمل کر لیا ہے', 'ur')).toBe(true);
    expect(looksLikeLanguage('API کی deployment کل production پر ہوگی', 'ur')).toBe(true);
    expect(looksLikeLanguage('2026', 'ur')).toBe(true);
    expect(looksLikeLanguage('2026', 'de')).toBe(true);
  });

  it('accepts German that quotes a short Urdu name', () => {
    expect(looksLikeLanguage('Das Produkt heißt Tarjuman (ترجمان) und ist fertig.', 'de')).toBe(true);
  });

  it('rejects the wrong script', () => {
    expect(looksLikeLanguage(GERMAN, 'ur')).toBe(false);
    expect(looksLikeLanguage(URDU, 'en')).toBe(false);
  });
});
