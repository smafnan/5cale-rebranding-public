import { LANGUAGES, type LangCode } from '../../shared/languages';
import { SPEECH_RATE_MAX, SPEECH_RATE_MIN } from '../../shared/settings';

/**
 * Text helpers for the pipeline: cleaning up STT output and preparing text for speech.
 */

/** Non-speech annotations that Whisper-family models emit: [Musik], (Applaus), *lacht*, ♪ ... */
const ANNOTATION_PATTERN = /\[[^\]]{0,40}\]|\([^)]{0,40}\)|\*[^*]{0,40}\*|[♪♫🎵🎶]+/gu;

/** Collapse whitespace, drop non-speech annotations and stray wrapping quotes. */
export function normalizeTranscript(raw: string): string {
  let text = raw.replace(ANNOTATION_PATTERN, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/^["'“”„‚‘’«»]+|["'“”„‚‘’«»]+$/gu, '').trim();
  // A transcript that is only punctuation carries no words.
  if (!/[\p{L}\p{N}]/u.test(text)) return '';
  return text;
}

/**
 * Abbreviations after which a full stop does not end the sentence. Matched against the
 * word immediately before the full stop, lower-cased, without the stop.
 */
const ABBREVIATIONS = new Set([
  // German
  'z',
  'b',
  'd',
  'h',
  'u',
  'a',
  'o',
  'ä',
  'bzw',
  'ca',
  'dr',
  'prof',
  'nr',
  'evtl',
  'ggf',
  'inkl',
  'usw',
  'vgl',
  'bspw',
  'tel',
  'str',
  'hr',
  'fr',
  // English
  'mr',
  'mrs',
  'ms',
  'e',
  'g',
  'i',
  'vs',
  'etc',
  'inc',
  'ltd',
  'st',
  'no',
  'approx',
]);

function endsSentence(text: string, index: number, enders: string): boolean {
  const char = text[index];
  if (char === undefined || !enders.includes(char)) return false;
  const next = text[index + 1];
  // Enders inside a token ("3.5", "example.com") or before a closing quote/bracket are not boundaries yet.
  if (next !== undefined && !/\s/u.test(next)) return false;
  if (char !== '.') return true;

  // Look at the word before the full stop.
  let start = index;
  while (start > 0 && /[\p{L}\p{N}]/u.test(text[start - 1] ?? '')) start--;
  const word = text.slice(start, index);
  if (word.length === 0) return true;
  // "am 3. Mai": ordinals and enumerations read badly when cut.
  if (/^\p{N}+$/u.test(word)) return false;
  return !ABBREVIATIONS.has(word.toLowerCase());
}

function splitSentences(text: string, lang: LangCode): string[] {
  const enders = LANGUAGES[lang].sentenceEnders;
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!endsSentence(text, i, enders)) continue;
    // Swallow runs of terminators ("?!", "...").
    let end = i + 1;
    while (end < text.length && enders.includes(text[end] ?? '')) end++;
    const sentence = text.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
    i = end - 1;
  }
  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

const CLAUSE_BREAKS = ',;:،؛—–';

/** Break an over-long sentence at the last clause break (or space) before `maxChars`. */
function wrapLongSentence(sentence: string, maxChars: number): string[] {
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > maxChars) {
    let cut = -1;
    for (let i = Math.min(maxChars, rest.length - 1); i > maxChars * 0.4; i--) {
      if (CLAUSE_BREAKS.includes(rest[i] ?? '') && /\s/u.test(rest[i + 1] ?? ' ')) {
        cut = i + 1;
        break;
      }
    }
    if (cut === -1) {
      const space = rest.lastIndexOf(' ', maxChars);
      cut = space > maxChars * 0.4 ? space : maxChars;
    }
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export interface SplitOptions {
  /** Upper bound for a chunk. */
  maxChars?: number;
  /** Chunks are merged with their neighbour until they reach this size. */
  minChars?: number;
}

/**
 * Split text into chunks that are synthesized as separate audio files, so the first
 * sentence can start playing while the rest is still being generated.
 *
 * Chunks end on sentence boundaries where possible, never inside a word, and their
 * concatenation (joined by spaces) equals the normalized input.
 */
export function splitForSpeech(text: string, lang: LangCode, options: SplitOptions = {}): string[] {
  const maxChars = options.maxChars ?? 220;
  const minChars = Math.min(options.minChars ?? 60, maxChars);
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const pieces = splitSentences(normalized, lang).flatMap((sentence) =>
    sentence.length > maxChars ? wrapLongSentence(sentence, maxChars) : [sentence],
  );

  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (!current) {
      current = piece;
    } else if (current.length < minChars && current.length + 1 + piece.length <= maxChars) {
      current = `${current} ${piece}`;
    } else {
      chunks.push(current);
      current = piece;
    }
  }
  if (current) {
    const last = chunks[chunks.length - 1];
    // Avoid a tiny trailing chunk ("Danke.") that would be a separate request and an audible gap.
    if (last !== undefined && current.length < minChars / 2 && last.length + 1 + current.length <= maxChars) {
      chunks[chunks.length - 1] = `${last} ${current}`;
    } else {
      chunks.push(current);
    }
  }
  return chunks;
}

/**
 * Speaking rate for the next utterance. When translated speech is piling up in the
 * browser (the speaker is faster than the interpreter), talk faster to catch up.
 */
export function effectiveSpeechRate(baseRate: number, playbackLagMs: number): number {
  let boost = 1;
  if (playbackLagMs > 9_000) boost = 1.3;
  else if (playbackLagMs > 5_000) boost = 1.2;
  else if (playbackLagMs > 2_500) boost = 1.1;
  const rate = baseRate * boost;
  return Math.round(Math.min(SPEECH_RATE_MAX + 0.1, Math.max(SPEECH_RATE_MIN, rate)) * 100) / 100;
}

/** Root-mean-square level of 16-bit PCM, 0..1. */
export function pcmRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const s = (pcm[i] ?? 0) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / pcm.length);
}
