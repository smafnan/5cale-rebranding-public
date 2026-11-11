import { LANG_CODES, type LangCode } from '../../../shared/languages';
import type { VoiceInfo } from '../../../shared/protocol';
import { httpRequest } from '../http';
import { ProviderError, type TtsProvider, type TtsRequest, type TtsResult } from '../types';
import { escapeSsmlText, NEURAL_VOICES, resolveVoice, ssmlRate } from './voices';

/**
 * Azure AI Speech text-to-speech (official REST API).
 *
 * Serves the same neural voices as the Edge endpoint, but under a contract: the free F0
 * tier includes 0.5 million characters per month, and the resource can be created in an
 * EU region. This is the recommended voice provider once the PoC is used for real meetings.
 */

const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

export interface AzureCredentials {
  key: string;
  region: string;
}

/**
 * Accepts either `region:key` in the key itself (convenient for the Settings dialog, which
 * has one field per service) or a bare key plus a separately configured region.
 */
export function parseAzureCredentials(
  rawKey: string | undefined,
  region: string | undefined,
): AzureCredentials | undefined {
  const value = rawKey?.trim();
  if (!value) return undefined;
  const colon = value.indexOf(':');
  if (colon > 0) {
    const inlineRegion = value.slice(0, colon).trim().toLowerCase();
    const key = value.slice(colon + 1).trim();
    if (/^[a-z0-9]+$/.test(inlineRegion) && key) return { region: inlineRegion, key };
    return undefined;
  }
  const configuredRegion = region?.trim().toLowerCase();
  if (!configuredRegion || !/^[a-z0-9]+$/.test(configuredRegion)) return undefined;
  return { region: configuredRegion, key: value };
}

export interface AzureTtsOptions {
  getKey: () => string | undefined;
  getRegion: () => string | undefined;
  fetchImpl?: typeof fetch;
}

export class AzureTtsProvider implements TtsProvider {
  readonly id = 'azure';
  readonly kind = 'tts' as const;
  readonly label = 'Azure AI Speech neural voices';
  readonly requiresKey = true;
  readonly timeoutMs = 10_000;

  constructor(private readonly options: AzureTtsOptions) {}

  private credentials(): AzureCredentials | undefined {
    return parseAzureCredentials(this.options.getKey(), this.options.getRegion());
  }

  isConfigured(): boolean {
    return this.credentials() !== undefined;
  }

  supportsLanguage(lang: LangCode): boolean {
    return (LANG_CODES as readonly string[]).includes(lang);
  }

  voices(): VoiceInfo[] {
    return NEURAL_VOICES.map((v) => ({
      id: v.id,
      provider: this.id,
      lang: v.lang,
      locale: v.locale,
      label: v.name,
      gender: v.gender,
    }));
  }

  async synthesize(request: TtsRequest): Promise<TtsResult> {
    const credentials = this.credentials();
    if (!credentials) {
      throw new ProviderError(
        this.id,
        'auth',
        'AZURE_SPEECH_KEY (as region:key) or AZURE_SPEECH_REGION is not set',
      );
    }
    const voice = resolveVoice(request.lang, request.voice);
    const ssml =
      `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${voice.locale}'>` +
      `<voice name='${voice.id}'><prosody rate='${ssmlRate(request.rate)}'>${escapeSsmlText(request.text)}</prosody></voice>` +
      '</speak>';

    const response = await httpRequest({
      providerId: this.id,
      url: `https://${credentials.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      headers: {
        'Ocp-Apim-Subscription-Key': credentials.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
        'User-Agent': 'tarjuman',
      },
      body: ssml,
      signal: request.signal,
      fetchImpl: this.options.fetchImpl,
    });
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.byteLength === 0) throw new ProviderError(this.id, 'bad_response', 'Azure returned no audio');
    return { audio, mime: 'audio/mpeg', voice: voice.id };
  }
}
