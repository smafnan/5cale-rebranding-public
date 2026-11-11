import { describe, expect, it } from 'vitest';

import { judgeTranscript, isRepetitionLoop, normalizeForMatch } from './hallucination';
import { ConversationMemory } from './memory';
import { effectiveSpeechRate, normalizeTranscript, pcmRms, splitForSpeech } from './text';

describe('normalizeTranscript', () => {
  it('removes non-speech annotations, stray quotes and extra whitespace', () => {
    expect(normalizeTranscript('  [Musik]  Guten   Morgen (Applaus) ♪ ')).toBe('Guten Morgen');
    expect(normalizeTranscript('„Guten Morgen.“')).toBe('Guten Morgen.');
    expect(normalizeTranscript('*lacht*')).toBe('');
    expect(normalizeTranscript(' ... ?! ')).toBe('');
  });
});

describe('splitForSpeech', () => {
  const join = (chunks: string[]) => chunks.join(' ');

  it('leaves short text alone', () => {
    expect(splitForSpeech('Guten Morgen. Wie geht es Ihnen?', 'de')).toEqual([
      'Guten Morgen. Wie geht es Ihnen?',
    ]);
    expect(splitForSpeech('   ', 'de')).toEqual([]);
  });

  it('splits long text at sentence ends without losing or reordering anything', () => {
    const text = Array.from(
      { length: 9 },
      (_, i) => `Dies ist der Satz Nummer ${i + 1} einer längeren Erklärung.`,
    ).join(' ');
    const chunks = splitForSpeech(text, 'de');
    expect(chunks.length).toBeGreaterThan(1);
    expect(join(chunks)).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(220);
      expect(chunk).toMatch(/\.$/);
    }
  });

  it('knows the Urdu full stop', () => {
    const sentence = 'ہم اگلے ہفتے نیا ورژن جاری کریں گے اور اس کے بعد ٹیم کے ساتھ ایک میٹنگ ہوگی۔';
    const text = Array.from({ length: 5 }, () => sentence).join(' ');
    const chunks = splitForSpeech(text, 'ur');
    expect(chunks.length).toBeGreaterThan(1);
    expect(join(chunks)).toBe(text);
    for (const chunk of chunks) expect(chunk.endsWith('۔')).toBe(true);
  });

  it('does not cut after abbreviations, ordinals or inside numbers', () => {
    const filler = 'Das ist ein längerer Satz, der genug Text liefert, damit überhaupt geteilt werden muss.';
    const text = `${filler} Wir treffen uns am 3. Mai, z. B. um 10.30 Uhr mit Dr. Weber. ${filler} ${filler}`;
    const chunks = splitForSpeech(text, 'de');
    expect(join(chunks)).toBe(text);
    for (const chunk of chunks) {
      expect(chunk).not.toMatch(/am 3\.$/);
      expect(chunk).not.toMatch(/z\.$/);
      expect(chunk).not.toMatch(/Dr\.$/);
      expect(chunk).not.toMatch(/10\.$/);
    }
  });

  it('wraps a sentence that is too long on its own, at a clause break', () => {
    const sentence = `${Array.from({ length: 30 }, (_, i) => `Teil ${i + 1} der Aufzählung`).join(', ')}.`;
    const chunks = splitForSpeech(sentence, 'de', { maxChars: 120 });
    expect(chunks.length).toBeGreaterThan(2);
    expect(join(chunks)).toBe(sentence);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(120);
    expect(chunks[0]?.endsWith(',')).toBe(true);
  });
});

describe('effectiveSpeechRate', () => {
  it('speeds up in steps as translated speech queues up, within limits', () => {
    expect(effectiveSpeechRate(1, 0)).toBe(1);
    expect(effectiveSpeechRate(1, 3_000)).toBe(1.1);
    expect(effectiveSpeechRate(1, 6_000)).toBe(1.2);
    expect(effectiveSpeechRate(1, 20_000)).toBe(1.3);
    expect(effectiveSpeechRate(1.5, 20_000)).toBe(1.6);
    expect(effectiveSpeechRate(0.5, 0)).toBe(0.7);
  });
});

describe('pcmRms', () => {
  it('measures level on a 0..1 scale', () => {
    expect(pcmRms(new Int16Array(0))).toBe(0);
    expect(pcmRms(new Int16Array(100))).toBe(0);
    expect(pcmRms(new Int16Array(100).fill(16384))).toBeCloseTo(0.5, 3);
  });
});

describe('judgeTranscript', () => {
  const evidence = (lang: 'ur' | 'de' | 'en', signals = {}, audioMs = 4_000) => ({ lang, audioMs, signals });
  const kept = (text: string, lang: 'ur' | 'de' | 'en', signals = {}, audioMs = 4_000) =>
    judgeTranscript(text, evidence(lang, signals, audioMs)).keep;

  it('keeps ordinary business sentences, including ones about subtitles, translation and subscriptions', () => {
    expect(kept('Können wir mit dem Stand des Sprints anfangen?', 'de')).toBe(true);
    expect(kept('Die Untertitel der Präsentation sind falsch.', 'de')).toBe(true);
    expect(kept('The document was translated by our team.', 'en')).toBe(true);
    expect(kept('Customers can subscribe to the premium plan.', 'en')).toBe(true);
    expect(kept('ہمارے سبسکرائبرز بڑھ رہے ہیں', 'ur')).toBe(true);
    expect(kept('ہم نے payment module مکمل کر لیا ہے', 'ur')).toBe(true);
    expect(kept('Yes, the deployment is done.', 'ur')).toBe(true);
  });

  it('drops well-known recognition artefacts', () => {
    for (const [text, lang] of [
      ['Untertitel der Amara.org-Community', 'de'],
      ['Untertitelung des ZDF für funk, 2017', 'de'],
      ['Untertitel im Auftrag des ZDF, 2021', 'de'],
      ['Thanks for watching!', 'en'],
      ['Thank you so much for watching.', 'en'],
      ['Please subscribe to my channel.', 'en'],
      ['چینل کو سبسکرائب کریں', 'ur'],
      ['ویڈیو کو لائک کریں', 'ur'],
    ] as const) {
      const verdict = judgeTranscript(text, evidence(lang));
      expect(verdict, text).toMatchObject({ keep: false, reason: 'hallucination' });
    }
  });

  it('matches Urdu regardless of which code points the recognizer used for the same letters', () => {
    // Arabic yeh (U+064A) and kaf (U+0643) instead of the Urdu forms.
    expect(kept('چينل كو سبسكرائب كريں', 'ur')).toBe(false);
    expect(normalizeForMatch('كريں')).toBe(normalizeForMatch('کریں'));
  });

  it("applies Whisper's own no-speech rule and a confidence floor", () => {
    expect(
      judgeTranscript('Guten Morgen zusammen.', evidence('de', { noSpeechProb: 0.8, avgLogProb: -1.2 })),
    ).toMatchObject({
      keep: false,
      reason: 'no_speech',
    });
    expect(kept('Guten Morgen zusammen.', 'de', { noSpeechProb: 0.8, avgLogProb: -0.3 })).toBe(true);
    expect(kept('Guten Morgen zusammen.', 'de', { avgLogProb: -1.7 })).toBe(false);
    expect(kept('Guten Morgen zusammen.', 'de', { compressionRatio: 2.9 })).toBe(false);
  });

  it('drops decoding loops', () => {
    expect(isRepetitionLoop('ja ja ja ja ja ja ja ja ja')).toBe(true);
    expect(isRepetitionLoop('vielen dank vielen dank vielen dank vielen dank vielen dank')).toBe(true);
    expect(isRepetitionLoop('wir haben das modul getestet und es funktioniert jetzt sehr gut')).toBe(false);
    expect(kept('Ja ja ja ja ja ja ja ja ja ja.', 'de')).toBe(false);
  });

  it('drops text in the wrong script for the channel, and an echoed prompt', () => {
    expect(kept('हम अगले हफ्ते मिलेंगे', 'ur')).toBe(false);
    expect(kept('ہم اگلے ہفتے ملیں گے', 'de')).toBe(false);
    expect(kept('Dies ist ein Gespräch in einem geschäftlichen Meeting.', 'de')).toBe(false);
    // The echo may include the glossary that was appended to the prompt, or stop part-way.
    const withHints = (text: string) =>
      judgeTranscript(text, { lang: 'de', audioMs: 6_000, signals: {}, hints: ['Khan', 'SAP'] }).keep;
    expect(withHints('Dies ist ein Gespräch in einem geschäftlichen Meeting. Khan, SAP.')).toBe(false);
    expect(withHints('Dies ist ein Gespräch in einem geschäftlichen Meeting. Khan')).toBe(false);
    expect(withHints('Dies ist ein Gespräch in einem geschäftlichen Meeting über SAP mit Herrn Khan.')).toBe(
      true,
    );
    expect(kept('2026', 'de')).toBe(true);
  });

  it('keeps a clear "Vielen Dank." but not one guessed from weak audio', () => {
    expect(kept('Vielen Dank.', 'de', { noSpeechProb: 0.05, avgLogProb: -0.2 })).toBe(true);
    expect(kept('Vielen Dank.', 'de', { noSpeechProb: 0.45, avgLogProb: -0.3 })).toBe(false);
    expect(kept('Vielen Dank.', 'de', { noSpeechProb: 0.05, avgLogProb: -0.9 })).toBe(false);
    // A recognizer without confidence signals makes its own no-speech decision, so its
    // one-word answers are believed: "yes", "okay" and "thank you" are normal replies.
    for (const reply of ['شکریہ', 'جی', 'ٹھیک ہے۔', 'ہاں'])
      expect(kept(reply, 'ur', {}, 900), reply).toBe(true);
    expect(kept('Ja.', 'de', {}, 800)).toBe(true);
  });

  it('drops more text than the audio could hold', () => {
    const long = 'Dies ist ein ziemlich langer Satz, der niemals in eine einzige Sekunde passen würde.';
    expect(kept(long, 'de', {}, 1_000)).toBe(false);
    expect(kept(long, 'de', {}, 5_000)).toBe(true);
  });
});

describe('ConversationMemory', () => {
  it('keeps the most recent turns within its bounds, oldest first', () => {
    const memory = new ConversationMemory(4, 20);
    for (let i = 1; i <= 6; i++)
      memory.add({ speaker: i % 2 ? 'me' : 'them', lang: 'de', text: `Satz ${i}` });
    memory.add({ speaker: 'me', lang: 'de', text: '   ' });
    expect(memory.size).toBe(4);
    expect(memory.recent().map((turn) => turn.text)).toEqual(['Satz 3', 'Satz 4', 'Satz 5', 'Satz 6']);
    expect(memory.recent(2).map((turn) => turn.text)).toEqual(['Satz 5', 'Satz 6']);
    expect(memory.recent(6, 13).map((turn) => turn.text)).toEqual(['Satz 5', 'Satz 6']);

    memory.add({ speaker: 'me', lang: 'de', text: 'x'.repeat(50) });
    expect(memory.recent(1)[0]?.text).toBe(`${'x'.repeat(20)}…`);

    memory.clear();
    expect(memory.recent()).toEqual([]);
  });
});
