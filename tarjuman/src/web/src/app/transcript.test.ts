import { describe, expect, it } from 'vitest';

import type { TranscriptEntry } from '../state/types';
import { formatTranscript, transcriptFileName } from './transcript';

function entry(fields: Partial<TranscriptEntry>): TranscriptEntry {
  return {
    id: 'u1',
    channel: 'outgoing',
    createdAt: new Date(2026, 10, 11, 9, 5, 7).getTime(),
    typed: false,
    status: 'done',
    sourceLang: 'ur',
    targetLang: 'de',
    sourceText: 'ہم اگلے ہفتے ریلیز کریں گے۔',
    translations: { de: 'Wir veröffentlichen nächste Woche.', en: 'We will release next week.' },
    audioMs: 2000,
    latencyMs: 1800,
    timings: null,
    providers: {},
    dropReason: null,
    error: null,
    ...fields,
  };
}

const entries = [
  entry({}),
  entry({
    id: 'u2',
    channel: 'incoming',
    sourceLang: 'de',
    targetLang: 'ur',
    sourceText: 'Sehr gut, danke.',
    translations: { ur: 'بہت اچھا، شکریہ۔', en: 'Very good, thank you.' },
  }),
  entry({ id: 'u3', status: 'transcribing', sourceText: null, translations: {} }),
  entry({ id: 'u4', status: 'dropped', sourceText: 'Untertitel der Amara.org-Community' }),
];

describe('formatTranscript', () => {
  it('writes Markdown with the speaker, the original and every translation', () => {
    const md = formatTranscript(entries, 'markdown');
    expect(md).toMatch(/^# Meeting transcript/);
    expect(md).toContain('**09:05:07 · Me**');
    expect(md).toContain('- **Urdu:** ہم اگلے ہفتے ریلیز کریں گے۔');
    expect(md).toContain('- **German:** Wir veröffentlichen nächste Woche.');
    expect(md).toContain('- **English:** We will release next week.');
    expect(md).toContain('· Them**');
  });

  it('puts the original first, then the spoken translation, then the other captions', () => {
    const md = formatTranscript([entries[1]!], 'markdown');
    const order = ['German', 'Urdu', 'English'].map((name) => md.indexOf(`**${name}:**`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((index) => index >= 0)).toBe(true);
  });

  it('leaves out unfinished and rejected utterances', () => {
    for (const format of ['markdown', 'text', 'json'] as const) {
      const out = formatTranscript(entries, format);
      expect(out).not.toContain('Amara');
      expect(out.match(/\bMe\b/g) ?? []).toHaveLength(1);
    }
  });

  it('writes JSON that can be parsed back', () => {
    const parsed = JSON.parse(formatTranscript(entries, 'json')) as { speaker: string; language: string }[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ speaker: 'Me', language: 'ur' });
    expect(parsed[1]).toMatchObject({ speaker: 'Them', language: 'de' });
  });

  it('writes plain text with language tags', () => {
    const text = formatTranscript(entries, 'text');
    expect(text).toContain('09:05:07 Me\n  [ur] ');
    expect(text).toContain('  [de] Wir veröffentlichen nächste Woche.');
  });
});

describe('transcriptFileName', () => {
  it('contains a sortable timestamp and the right extension', () => {
    const now = new Date(2026, 10, 11, 9, 5);
    expect(transcriptFileName('markdown', now)).toBe('tarjuman-transcript-20261111-0905.md');
    expect(transcriptFileName('json', now)).toBe('tarjuman-transcript-20261111-0905.json');
    expect(transcriptFileName('text', now)).toBe('tarjuman-transcript-20261111-0905.txt');
  });
});
