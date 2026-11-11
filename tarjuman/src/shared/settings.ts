import { isLangCode, LANG_CODES, type LangCode } from './languages';

/**
 * A call has two independent, simultaneous interpretation channels.
 *
 * - `outgoing`: what *I* say. Captured from my microphone, translated, and spoken to
 *   the other side (normally through a virtual microphone that Teams listens to).
 * - `incoming`: what *they* say. Captured from the Teams audio, translated, and
 *   spoken to me (normally through my headphones).
 */
export const CHANNEL_IDS = ['outgoing', 'incoming'] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

export function isChannelId(value: unknown): value is ChannelId {
  return typeof value === 'string' && (CHANNEL_IDS as readonly string[]).includes(value);
}

export type Formality = 'formal' | 'informal';

export interface ChannelSettings {
  /** Language spoken on this channel. */
  sourceLang: LangCode;
  /** Language this channel is translated into (text and speech). */
  targetLang: LangCode;
  /** TTS voice id for `targetLang`, or `'auto'` for the server default. */
  voice: string;
  /** Whether translated speech is synthesized for this channel (captions are always produced). */
  speak: boolean;
  /** Base speaking-rate multiplier, 1 = normal. The server may speed up further to catch up. */
  speechRate: number;
}

export interface GlossaryEntry {
  /** Term as it is spoken / written in any of the languages (names, product names, jargon). */
  term: string;
  /** Required rendering in translations. Empty = keep the term unchanged. */
  translation: string;
}

/** Everything the server needs to know to interpret one call. Sent on `session.start`. */
export interface SessionSettings {
  channels: Record<ChannelId, ChannelSettings>;
  /** Additional text-only caption languages produced for every utterance (e.g. English). */
  captionLangs: LangCode[];
  /** Register used for German ("Sie" vs "du") and Urdu ("آپ" vs "تم"). */
  formality: Formality;
  /** Names and terms that must be rendered consistently. */
  glossary: GlossaryEntry[];
  /** Free-text description of the meeting, used to disambiguate jargon. */
  meetingContext: string;
}

export const SPEECH_RATE_MIN = 0.7;
export const SPEECH_RATE_MAX = 1.5;
export const MAX_GLOSSARY_ENTRIES = 60;
export const MAX_GLOSSARY_TERM_CHARS = 80;
export const MAX_MEETING_CONTEXT_CHARS = 600;

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  channels: {
    outgoing: { sourceLang: 'ur', targetLang: 'de', voice: 'auto', speak: true, speechRate: 1 },
    incoming: { sourceLang: 'de', targetLang: 'ur', voice: 'auto', speak: true, speechRate: 1 },
  },
  captionLangs: ['en'],
  formality: 'formal',
  glossary: [],
  meetingContext: '',
};

/** All languages an utterance on `channel` must be translated into, target language first. */
export function translationTargets(settings: SessionSettings, channel: ChannelId): LangCode[] {
  const ch = settings.channels[channel];
  const targets: LangCode[] = [ch.targetLang];
  for (const lang of settings.captionLangs) {
    if (lang !== ch.sourceLang && !targets.includes(lang)) targets.push(lang);
  }
  return targets;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeChannel(input: unknown, fallback: ChannelSettings): ChannelSettings {
  const raw = (input ?? {}) as Partial<Record<keyof ChannelSettings, unknown>>;
  const sourceLang = isLangCode(raw.sourceLang) ? raw.sourceLang : fallback.sourceLang;
  let targetLang = isLangCode(raw.targetLang) ? raw.targetLang : fallback.targetLang;
  if (targetLang === sourceLang) {
    targetLang = LANG_CODES.find((code) => code !== sourceLang) ?? fallback.targetLang;
  }
  const rate = typeof raw.speechRate === 'number' && Number.isFinite(raw.speechRate) ? raw.speechRate : 1;
  return {
    sourceLang,
    targetLang,
    voice:
      typeof raw.voice === 'string' && raw.voice.length > 0 && raw.voice.length <= 80 ? raw.voice : 'auto',
    speak: typeof raw.speak === 'boolean' ? raw.speak : fallback.speak,
    speechRate: clamp(rate, SPEECH_RATE_MIN, SPEECH_RATE_MAX),
  };
}

/**
 * Turn untrusted input (client message, localStorage) into valid settings.
 * Never throws: anything invalid falls back to the default for that field.
 */
export function sanitizeSessionSettings(input: unknown): SessionSettings {
  const raw = (input ?? {}) as Partial<Record<keyof SessionSettings, unknown>>;
  const rawChannels = (raw.channels ?? {}) as Partial<Record<ChannelId, unknown>>;
  const defaults = DEFAULT_SESSION_SETTINGS;

  const captionLangs: LangCode[] = [];
  if (Array.isArray(raw.captionLangs)) {
    for (const lang of raw.captionLangs) {
      if (isLangCode(lang) && !captionLangs.includes(lang)) captionLangs.push(lang);
    }
  } else {
    captionLangs.push(...defaults.captionLangs);
  }

  const glossary: GlossaryEntry[] = [];
  if (Array.isArray(raw.glossary)) {
    for (const entry of raw.glossary.slice(0, MAX_GLOSSARY_ENTRIES)) {
      const e = (entry ?? {}) as Partial<Record<keyof GlossaryEntry, unknown>>;
      const term = typeof e.term === 'string' ? e.term.trim().slice(0, MAX_GLOSSARY_TERM_CHARS) : '';
      const translation =
        typeof e.translation === 'string' ? e.translation.trim().slice(0, MAX_GLOSSARY_TERM_CHARS) : '';
      if (term) glossary.push({ term, translation });
    }
  }

  return {
    channels: {
      outgoing: sanitizeChannel(rawChannels.outgoing, defaults.channels.outgoing),
      incoming: sanitizeChannel(rawChannels.incoming, defaults.channels.incoming),
    },
    captionLangs,
    formality: raw.formality === 'informal' ? 'informal' : 'formal',
    glossary,
    meetingContext:
      typeof raw.meetingContext === 'string'
        ? raw.meetingContext.trim().slice(0, MAX_MEETING_CONTEXT_CHARS)
        : '',
  };
}
