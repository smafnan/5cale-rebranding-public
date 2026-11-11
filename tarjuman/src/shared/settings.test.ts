import { describe, expect, it } from 'vitest';

import { isLangCode, LANG_CODES, LANGUAGES, languageName } from './languages';
import {
  DEFAULT_SESSION_SETTINGS,
  isChannelId,
  MAX_GLOSSARY_ENTRIES,
  MAX_GLOSSARY_TERM_CHARS,
  MAX_MEETING_CONTEXT_CHARS,
  sanitizeSessionSettings,
  SPEECH_RATE_MAX,
  SPEECH_RATE_MIN,
  translationTargets,
  type SessionSettings,
} from './settings';

function settings(overrides: Partial<SessionSettings> = {}): SessionSettings {
  return { ...structuredClone(DEFAULT_SESSION_SETTINGS), ...overrides };
}

describe('sanitizeSessionSettings', () => {
  it('returns the defaults for input that is not an object', () => {
    for (const input of [undefined, null, 42, 'settings', true, []]) {
      expect(sanitizeSessionSettings(input)).toEqual(DEFAULT_SESSION_SETTINGS);
    }
  });

  it('passes valid settings through unchanged', () => {
    const valid: SessionSettings = {
      channels: {
        outgoing: {
          sourceLang: 'en',
          targetLang: 'de',
          voice: 'de-DE-ConradNeural',
          speak: false,
          speechRate: 1.2,
        },
        incoming: { sourceLang: 'de', targetLang: 'en', voice: 'auto', speak: true, speechRate: 0.9 },
      },
      captionLangs: ['ur'],
      formality: 'informal',
      glossary: [{ term: 'Tarjuman', translation: '' }],
      meetingContext: 'Quarterly planning',
    };
    expect(sanitizeSessionSettings(valid)).toEqual(valid);
  });

  it('does not hand out the shared default objects', () => {
    const result = sanitizeSessionSettings({});
    expect(result.channels).not.toBe(DEFAULT_SESSION_SETTINGS.channels);
    expect(result.channels.outgoing).not.toBe(DEFAULT_SESSION_SETTINGS.channels.outgoing);
    expect(result.glossary).not.toBe(DEFAULT_SESSION_SETTINGS.glossary);
    expect(result.captionLangs).not.toBe(DEFAULT_SESSION_SETTINGS.captionLangs);
  });

  it('replaces fields of the wrong type with the default for that field only', () => {
    const result = sanitizeSessionSettings({
      channels: {
        outgoing: { sourceLang: 7, targetLang: ['de'], voice: 12, speak: 'yes', speechRate: '1.2' },
        incoming: 'broken',
      },
      captionLangs: 'en',
      formality: 'rude',
      glossary: { term: 'x' },
      meetingContext: { text: 'x' },
    });
    expect(result).toEqual(DEFAULT_SESSION_SETTINGS);
  });

  it('keeps the valid half of a partly valid channel', () => {
    const result = sanitizeSessionSettings({
      channels: { outgoing: { sourceLang: 'en', speak: false, speechRate: 1.3, targetLang: 'klingon' } },
    });
    expect(result.channels.outgoing).toEqual({
      sourceLang: 'en',
      targetLang: 'de',
      voice: 'auto',
      speak: false,
      speechRate: 1.3,
    });
    expect(result.channels.incoming).toEqual(DEFAULT_SESSION_SETTINGS.channels.incoming);
  });

  it('never leaves a channel translating a language into itself', () => {
    for (const lang of LANG_CODES) {
      const result = sanitizeSessionSettings({
        channels: {
          outgoing: { sourceLang: lang, targetLang: lang },
          incoming: { sourceLang: lang, targetLang: lang },
        },
      });
      for (const channel of [result.channels.outgoing, result.channels.incoming]) {
        expect(channel.sourceLang).toBe(lang);
        expect(isLangCode(channel.targetLang)).toBe(true);
        expect(channel.targetLang).not.toBe(lang);
      }
    }
  });

  it('repairs a clash that only appears after falling back to the default target', () => {
    // Outgoing defaults to target "de"; a source of "de" with a missing target must not yield de -> de.
    const result = sanitizeSessionSettings({ channels: { outgoing: { sourceLang: 'de' } } });
    expect(result.channels.outgoing.sourceLang).toBe('de');
    expect(result.channels.outgoing.targetLang).not.toBe('de');
  });

  it('clamps the speech rate and replaces non-finite rates with 1', () => {
    const rate = (speechRate: unknown) =>
      sanitizeSessionSettings({ channels: { outgoing: { speechRate } } }).channels.outgoing.speechRate;
    expect(rate(0.1)).toBe(SPEECH_RATE_MIN);
    expect(rate(-3)).toBe(SPEECH_RATE_MIN);
    expect(rate(9)).toBe(SPEECH_RATE_MAX);
    expect(rate(1.25)).toBe(1.25);
    expect(rate(NaN)).toBe(1);
    expect(rate(Infinity)).toBe(1);
    expect(rate(-Infinity)).toBe(1);
    expect(rate(null)).toBe(1);
  });

  it('rejects empty and over-long voice ids', () => {
    const voice = (value: unknown) =>
      sanitizeSessionSettings({ channels: { incoming: { voice: value } } }).channels.incoming.voice;
    expect(voice('')).toBe('auto');
    expect(voice('v'.repeat(81))).toBe('auto');
    expect(voice('v'.repeat(80))).toBe('v'.repeat(80));
    expect(voice('ur-PK-AsadNeural')).toBe('ur-PK-AsadNeural');
  });

  it('caps the glossary at the maximum number of entries, keeping the first ones', () => {
    const glossary = Array.from({ length: 200 }, (_, i) => ({ term: `term-${i}`, translation: `t-${i}` }));
    const result = sanitizeSessionSettings({ glossary });
    expect(result.glossary).toHaveLength(MAX_GLOSSARY_ENTRIES);
    expect(result.glossary[0]).toEqual({ term: 'term-0', translation: 't-0' });
    expect(result.glossary[MAX_GLOSSARY_ENTRIES - 1]).toEqual({
      term: `term-${MAX_GLOSSARY_ENTRIES - 1}`,
      translation: `t-${MAX_GLOSSARY_ENTRIES - 1}`,
    });
  });

  it('trims and truncates glossary terms and drops unusable entries', () => {
    const result = sanitizeSessionSettings({
      glossary: [
        { term: '  Kubernetes  ', translation: '  ' },
        { term: 'x'.repeat(500), translation: 'y'.repeat(500) },
        { term: '   ', translation: 'orphan translation' },
        { term: 42, translation: 'number' },
        { translation: 'no term' },
        null,
        'a string',
        { term: 'Müller GmbH', translation: 7 },
      ],
    });
    expect(result.glossary).toEqual([
      { term: 'Kubernetes', translation: '' },
      { term: 'x'.repeat(MAX_GLOSSARY_TERM_CHARS), translation: 'y'.repeat(MAX_GLOSSARY_TERM_CHARS) },
      { term: 'Müller GmbH', translation: '' },
    ]);
  });

  it('trims and truncates the meeting context', () => {
    expect(sanitizeSessionSettings({ meetingContext: '  budget review  ' }).meetingContext).toBe(
      'budget review',
    );
    const long = sanitizeSessionSettings({ meetingContext: 'z'.repeat(5_000) }).meetingContext;
    expect(long).toHaveLength(MAX_MEETING_CONTEXT_CHARS);
  });

  it('de-duplicates caption languages and drops unknown ones', () => {
    expect(
      sanitizeSessionSettings({ captionLangs: ['en', 'fr', 'en', 5, null, 'ur', 'en'] }).captionLangs,
    ).toEqual(['en', 'ur']);
  });

  it('respects an explicitly empty caption list but defaults a missing one', () => {
    expect(sanitizeSessionSettings({ captionLangs: [] }).captionLangs).toEqual([]);
    expect(sanitizeSessionSettings({}).captionLangs).toEqual(['en']);
  });

  it('only accepts the two known formality values', () => {
    expect(sanitizeSessionSettings({ formality: 'informal' }).formality).toBe('informal');
    expect(sanitizeSessionSettings({ formality: 'INFORMAL' }).formality).toBe('formal');
    expect(sanitizeSessionSettings({ formality: 1 }).formality).toBe('formal');
  });

  it('ignores unknown properties', () => {
    const result = sanitizeSessionSettings({
      admin: true,
      channels: { outgoing: { evil: 1 }, sideways: {} },
    });
    expect(result).toEqual(DEFAULT_SESSION_SETTINGS);
  });

  it('is idempotent', () => {
    const once = sanitizeSessionSettings({
      channels: { outgoing: { sourceLang: 'ur', targetLang: 'ur', speechRate: 99 } },
      glossary: [{ term: '  a ', translation: ' b ' }],
      captionLangs: ['de', 'de'],
      meetingContext: '  x ',
    });
    expect(sanitizeSessionSettings(once)).toEqual(once);
  });
});

describe('translationTargets', () => {
  it('puts the spoken target first, then the caption languages', () => {
    expect(translationTargets(DEFAULT_SESSION_SETTINGS, 'outgoing')).toEqual(['de', 'en']);
    expect(translationTargets(DEFAULT_SESSION_SETTINGS, 'incoming')).toEqual(['ur', 'en']);
  });

  it('keeps the target first even when a caption language is listed before it', () => {
    expect(translationTargets(settings({ captionLangs: ['en', 'de'] }), 'outgoing')).toEqual(['de', 'en']);
  });

  it('does not repeat the target language', () => {
    expect(translationTargets(settings({ captionLangs: ['de', 'en', 'de'] }), 'outgoing')).toEqual([
      'de',
      'en',
    ]);
  });

  it('never asks for a translation into the source language', () => {
    expect(translationTargets(settings({ captionLangs: ['ur', 'en'] }), 'outgoing')).toEqual(['de', 'en']);
    expect(translationTargets(settings({ captionLangs: ['de'] }), 'incoming')).toEqual(['ur']);
  });

  it('returns only the target when there are no caption languages', () => {
    expect(translationTargets(settings({ captionLangs: [] }), 'incoming')).toEqual(['ur']);
  });

  it('follows the channel configuration', () => {
    const custom = settings({ captionLangs: ['ur', 'de'] });
    custom.channels.outgoing = { ...custom.channels.outgoing, sourceLang: 'en', targetLang: 'ur' };
    expect(translationTargets(custom, 'outgoing')).toEqual(['ur', 'de']);
  });
});

describe('language registry', () => {
  it('recognises exactly the registered codes', () => {
    expect(LANG_CODES.every((code) => isLangCode(code))).toBe(true);
    for (const value of ['fr', 'UR', '', 'urdu', 1, null, undefined, {}])
      expect(isLangCode(value)).toBe(false);
  });

  it('has one consistent entry per code', () => {
    for (const code of LANG_CODES) {
      expect(LANGUAGES[code].code).toBe(code);
      expect(LANGUAGES[code].locale.startsWith(`${code}-`)).toBe(true);
      expect(languageName(code)).toBe(LANGUAGES[code].name);
    }
    expect(LANGUAGES.ur.dir).toBe('rtl');
    expect(LANGUAGES.ur.sentenceEnders).toContain('۔');
  });

  it('recognises channel ids', () => {
    expect(isChannelId('outgoing')).toBe(true);
    expect(isChannelId('incoming')).toBe(true);
    for (const value of ['both', '', 0, null, undefined]) expect(isChannelId(value)).toBe(false);
  });
});
