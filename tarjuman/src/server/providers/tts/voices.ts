import { LANGUAGES, type LangCode } from '../../../shared/languages';

/**
 * Microsoft neural voices, addressed by their "ShortName". The same catalogue is served
 * by the Edge read-aloud endpoint (free, no key) and by Azure AI Speech (official API).
 *
 * The first voice of each language is the default.
 */

export interface NeuralVoice {
  /** ShortName, e.g. `ur-PK-UzmaNeural`. */
  id: string;
  lang: LangCode;
  locale: string;
  /** Display name. */
  name: string;
  gender: 'female' | 'male';
}

function voice(id: string, lang: LangCode, name: string, gender: 'female' | 'male'): NeuralVoice {
  const [language, region] = id.split('-');
  return { id, lang, locale: `${language}-${region}`, name, gender };
}

export const NEURAL_VOICES: readonly NeuralVoice[] = [
  // Urdu
  voice('ur-PK-UzmaNeural', 'ur', 'Uzma (Pakistan)', 'female'),
  voice('ur-PK-AsadNeural', 'ur', 'Asad (Pakistan)', 'male'),
  voice('ur-IN-GulNeural', 'ur', 'Gul (India)', 'female'),
  voice('ur-IN-SalmanNeural', 'ur', 'Salman (India)', 'male'),
  // German
  voice('de-DE-KatjaNeural', 'de', 'Katja (Germany)', 'female'),
  voice('de-DE-ConradNeural', 'de', 'Conrad (Germany)', 'male'),
  voice('de-DE-SeraphinaMultilingualNeural', 'de', 'Seraphina (Germany, multilingual)', 'female'),
  voice('de-DE-FlorianMultilingualNeural', 'de', 'Florian (Germany, multilingual)', 'male'),
  voice('de-DE-AmalaNeural', 'de', 'Amala (Germany)', 'female'),
  voice('de-DE-KillianNeural', 'de', 'Killian (Germany)', 'male'),
  voice('de-AT-IngridNeural', 'de', 'Ingrid (Austria)', 'female'),
  voice('de-AT-JonasNeural', 'de', 'Jonas (Austria)', 'male'),
  voice('de-CH-LeniNeural', 'de', 'Leni (Switzerland)', 'female'),
  voice('de-CH-JanNeural', 'de', 'Jan (Switzerland)', 'male'),
  // English. The single-language voices come first: they answer faster than the multilingual ones.
  voice('en-US-AvaNeural', 'en', 'Ava (US)', 'female'),
  voice('en-US-AndrewNeural', 'en', 'Andrew (US)', 'male'),
  voice('en-US-AvaMultilingualNeural', 'en', 'Ava (US, multilingual)', 'female'),
  voice('en-US-AndrewMultilingualNeural', 'en', 'Andrew (US, multilingual)', 'male'),
  voice('en-US-EmmaMultilingualNeural', 'en', 'Emma (US, multilingual)', 'female'),
  voice('en-US-BrianMultilingualNeural', 'en', 'Brian (US, multilingual)', 'male'),
  voice('en-US-JennyNeural', 'en', 'Jenny (US)', 'female'),
  voice('en-US-GuyNeural', 'en', 'Guy (US)', 'male'),
  voice('en-GB-SoniaNeural', 'en', 'Sonia (UK)', 'female'),
  voice('en-GB-RyanNeural', 'en', 'Ryan (UK)', 'male'),
];

const BY_ID = new Map(NEURAL_VOICES.map((v) => [v.id, v]));

export function defaultVoice(lang: LangCode): NeuralVoice {
  const found = NEURAL_VOICES.find((v) => v.lang === lang);
  if (!found) throw new Error(`no neural voice for ${LANGUAGES[lang].name}`);
  return found;
}

/**
 * The voice to use for `lang`: the requested one if it exists AND speaks that language,
 * otherwise the default. A stale or mismatched voice id never causes a failure.
 */
export function resolveVoice(lang: LangCode, requested: string | undefined): NeuralVoice {
  const candidate = requested ? BY_ID.get(requested) : undefined;
  return candidate && candidate.lang === lang ? candidate : defaultVoice(lang);
}

/** SSML `rate` attribute for a speed multiplier: 1.1 -> "+10%", 0.9 -> "-10%". */
export function ssmlRate(multiplier: number): string {
  const percent = Math.round((Math.min(2, Math.max(0.5, multiplier)) - 1) * 100);
  return `${percent >= 0 ? '+' : ''}${percent}%`;
}

/** Escape text for inclusion in SSML and drop control characters the service rejects. */
export function escapeSsmlText(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex -- removing control characters is the point
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  );
}
