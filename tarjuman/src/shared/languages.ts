/**
 * Language registry shared by server and browser.
 *
 * Adding a language = add one entry here, one voice list in
 * `src/server/providers/tts/voices.ts`, and (optionally) hallucination phrases in
 * `src/server/pipeline/hallucination.ts`. Nothing else is language-specific.
 */

export const LANG_CODES = ['ur', 'de', 'en'] as const;

export type LangCode = (typeof LANG_CODES)[number];

export interface LanguageInfo {
  /** ISO 639-1 code. Also the code Whisper-family STT models expect. */
  code: LangCode;
  /** English name, used in prompts and the UI. */
  name: string;
  /** Name of the language in the language itself. */
  nativeName: string;
  /** Text direction for captions. */
  dir: 'ltr' | 'rtl';
  /** Default BCP-47 locale (used for TTS voices and browser speech APIs). */
  locale: string;
  /** Unicode script the language is normally written in. */
  script: 'Arab' | 'Latn';
  /** Sentence terminators used when splitting text for speech synthesis. */
  sentenceEnders: string;
}

export const LANGUAGES: Record<LangCode, LanguageInfo> = {
  ur: {
    code: 'ur',
    name: 'Urdu',
    nativeName: 'اردو',
    dir: 'rtl',
    locale: 'ur-PK',
    script: 'Arab',
    sentenceEnders: '۔؟!.?',
  },
  de: {
    code: 'de',
    name: 'German',
    nativeName: 'Deutsch',
    dir: 'ltr',
    locale: 'de-DE',
    script: 'Latn',
    sentenceEnders: '.!?',
  },
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    dir: 'ltr',
    locale: 'en-US',
    script: 'Latn',
    sentenceEnders: '.!?',
  },
};

export function isLangCode(value: unknown): value is LangCode {
  return typeof value === 'string' && (LANG_CODES as readonly string[]).includes(value);
}

export function languageName(code: LangCode): string {
  return LANGUAGES[code].name;
}
