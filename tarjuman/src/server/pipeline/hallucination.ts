import type { LangCode } from '../../shared/languages';
import type { DropReason } from '../../shared/protocol';
import { arabicScriptRatio } from '../providers/mt/prompt';
import { WHISPER_PROMPT_LEAD } from '../providers/stt/groqWhisper';
import type { SttResult } from '../providers/types';

/**
 * Decides whether a transcript is real speech or a speech-recognition artefact.
 *
 * Whisper-family models, when fed noise or near-silence, do not return nothing: they
 * return text they saw a lot in training — subtitle credits, "thanks for watching",
 * or one word repeated forever. Speaking that into a business call would be worse than
 * staying silent, so the pipeline drops it. The browser VAD already keeps most non-speech
 * away from the recognizer; this is the second line of defence.
 */

export type TranscriptVerdict = { keep: true } | { keep: false; reason: DropReason; detail: string };

/**
 * Urdu text reaches us with interchangeable code points for the same letter (Arabic vs
 * Persian yeh and kaf, several forms of heh, hamza written precomposed or combining).
 * Map them to one form so phrase matching does not depend on which the recognizer chose.
 */
export function unifyArabicScript(text: string): string {
  return text
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '') // short vowels, hamza marks, tatweel
    .replace(/[\u064a\u0649\u0626]/g, '\u06cc') // yeh variants and yeh-hamza -> Farsi yeh
    .replace(/\u0643/g, '\u06a9') // Arabic kaf -> keheh
    .replace(/[\u0647\u06d5\u06c0\u06c2]/g, '\u06c1'); // heh variants -> heh goal
}

/** Lower-case, strip punctuation and Latin diacritics, unify Urdu letter forms, collapse whitespace. */
export function normalizeForMatch(text: string): string {
  const latinFolded = text
    .toLowerCase()
    // Fold accents on Latin letters only; decomposing Arabic letters would change them.
    .replace(/[\u00c0-\u024f]/g, (char) => char.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  return unifyArabicScript(latinFolded)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build a pattern for Urdu text, written naturally and matched against unified letter forms. */
const urdu = (source: string): RegExp => new RegExp(unifyArabicScript(source));

/**
 * Text that is never something a meeting participant said. A transcript is dropped when,
 * after normalization, it CONTAINS one of these.
 *
 * Deliberately narrow: this tool is used to talk about subtitles, translation and
 * subscriptions, so a loose pattern ("translated by", "subscribe") would silence real speech.
 */
const ALWAYS_ARTEFACT: RegExp[] = [
  // German broadcast subtitle credits
  /\buntertitel\w*\b.*\b(zdf|ard|funk|amara|swr|wdr|ndr|orf)\b/,
  /\buntertitel\w* (von|durch) stephanie geiges\b/,
  /\bamara org\b/,
  /\bcopyright (wdr|swr|ndr|zdf|ard|br) \d{4}\b/,
  /^(swr|wdr|ndr|zdf) 20\d\d$/,
  // English video boilerplate
  /\bthank(s| you)( so much| very much)? for watching\b/,
  /\bsubscribe to (my|our|the) channel\b/,
  /\b(like|comment) and subscribe\b/,
  /\bsubtitles? by (the )?(amara|community)\b/,
  /\btranscribed by (https )?otter\b/,
  /\bsee you in the next video\b/,
  // Urdu video boilerplate
  urdu('چینل (کو )?(ضرور )?(لائک|سبسکرائب)'),
  urdu('ویڈیو (کو )?(لائک|شیئر)'),
  urdu('دیکھنے کا (بہت )?شکریہ'),
];

/**
 * Short phrases that people do say ("Vielen Dank.") but that Whisper also emits for noise.
 * A transcript that consists ONLY of one of these is dropped when the audio evidence is
 * weak (short clip or poor confidence), and kept otherwise.
 */
const WEAK_PHRASES: Record<LangCode, Set<string>> = {
  de: new Set(
    [
      'Vielen Dank',
      'Danke',
      'Danke schön',
      'Vielen Dank fürs Zuschauen',
      'Vielen Dank für Ihre Aufmerksamkeit',
      'Vielen Dank für die Aufmerksamkeit',
      'Bis zum nächsten Mal',
      'Tschüss',
      'Ja',
      'So',
      'Musik',
      "Das war's",
    ].map(normalizeForMatch),
  ),
  en: new Set(
    ['Thank you', 'Thanks', 'Thank you very much', 'Bye', 'Bye bye', 'You', 'Okay', 'So', 'Music', 'The end'].map(
      normalizeForMatch,
    ),
  ),
  ur: new Set(['شکریہ', 'بہت شکریہ', 'جی', 'ہاں', 'اچھا', 'ٹھیک ہے', 'موسیقی'].map(normalizeForMatch)),
};

/** Whisper's own decoding thresholds (openai/whisper transcribe.py defaults). */
const NO_SPEECH_THRESHOLD = 0.6;
const LOGPROB_THRESHOLD = -1.0;
const COMPRESSION_RATIO_THRESHOLD = 2.4;
/** Below this the recognizer was guessing, whatever it says about speech probability. */
const LOGPROB_FLOOR = -1.5;

/** Clips shorter than this give Whisper too little to work with to trust a stock phrase. */
const WEAK_PHRASE_MIN_AUDIO_MS = 1_500;

/** True when the text is mostly one short unit repeated (a decoding loop). */
export function isRepetitionLoop(normalized: string): boolean {
  const words = normalized.split(' ').filter(Boolean);
  if (words.length < 8) return false;

  // The same word many times in a row.
  let run = 1;
  for (let i = 1; i < words.length; i++) {
    run = words[i] === words[i - 1] ? run + 1 : 1;
    if (run >= 6) return true;
  }

  // The same 2-4 word phrase covering most of the text.
  for (let size = 2; size <= 4; size++) {
    if (words.length < size * 4) continue;
    const counts = new Map<string, number>();
    for (let i = 0; i + size <= words.length; i += size) {
      const gram = words.slice(i, i + size).join(' ');
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
    const top = Math.max(...counts.values());
    if (top >= 4 && top * size >= words.length * 0.7) return true;
  }
  return false;
}

export interface TranscriptEvidence {
  lang: LangCode;
  /** Duration of the audio the transcript came from. */
  audioMs: number;
  signals: Pick<SttResult, 'noSpeechProb' | 'avgLogProb' | 'compressionRatio'>;
}

export function judgeTranscript(text: string, evidence: TranscriptEvidence): TranscriptVerdict {
  const normalized = normalizeForMatch(text);
  if (!normalized) return { keep: false, reason: 'no_speech', detail: 'empty transcript' };

  const { noSpeechProb, avgLogProb, compressionRatio } = evidence.signals;

  if (noSpeechProb !== undefined && avgLogProb !== undefined) {
    if (noSpeechProb > NO_SPEECH_THRESHOLD && avgLogProb < LOGPROB_THRESHOLD) {
      return { keep: false, reason: 'no_speech', detail: 'recognizer reports no speech' };
    }
  }
  if (avgLogProb !== undefined && avgLogProb < LOGPROB_FLOOR) {
    return { keep: false, reason: 'hallucination', detail: 'recognizer confidence too low' };
  }
  if (compressionRatio !== undefined && compressionRatio > COMPRESSION_RATIO_THRESHOLD) {
    return { keep: false, reason: 'hallucination', detail: 'repetitive output' };
  }
  if (isRepetitionLoop(normalized)) {
    return { keep: false, reason: 'hallucination', detail: 'repetition loop' };
  }

  for (const pattern of ALWAYS_ARTEFACT) {
    if (pattern.test(normalized)) return { keep: false, reason: 'hallucination', detail: 'known recognition artefact' };
  }

  // Whisper sometimes echoes the prompt it was given instead of transcribing.
  const promptLead = normalizeForMatch(WHISPER_PROMPT_LEAD[evidence.lang]);
  if (normalized === promptLead) {
    return { keep: false, reason: 'hallucination', detail: 'recognizer echoed its prompt' };
  }

  // Urdu audio transcribed in Devanagari, or German audio in Arabic script, means the recognizer
  // slipped into another language. (Latin text on the Urdu channel is fine: English is mixed in.)
  if (evidence.lang === 'ur' && /[\u0900-\u097f]/u.test(text)) {
    return { keep: false, reason: 'hallucination', detail: 'wrong script (Devanagari)' };
  }
  if (evidence.lang !== 'ur' && /\p{L}/u.test(text) && arabicScriptRatio(text) > 0.5) {
    return { keep: false, reason: 'hallucination', detail: 'wrong script (Arabic)' };
  }

  if (WEAK_PHRASES[evidence.lang].has(normalized)) {
    const weakAudio = evidence.audioMs < WEAK_PHRASE_MIN_AUDIO_MS;
    const weakConfidence =
      (noSpeechProb !== undefined && noSpeechProb > 0.3) || (avgLogProb !== undefined && avgLogProb < -0.7);
    // A clear, deliberate "Vielen Dank." has strong confidence; the noise artefact does not.
    if (weakConfidence || (weakAudio && avgLogProb === undefined)) {
      return { keep: false, reason: 'hallucination', detail: 'stock phrase on weak audio' };
    }
  }

  return { keep: true };
}
