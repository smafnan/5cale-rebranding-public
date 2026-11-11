import type { LangCode } from '../../../shared/languages';
import { httpRequest, readJson } from '../http';
import { ProviderError, type MtProvider, type MtRequest, type MtResult } from '../types';
import { looksLikeLanguage } from './prompt';

/**
 * MyMemory (translated.net): a public translation-memory API that needs no key.
 *
 * It is the keyless safety net, not a quality option: it translates each sentence in
 * isolation (no conversation context, no glossary, no register control) and allows
 * 5,000 characters/day anonymously, or 50,000/day when a contact e-mail is supplied.
 */

const ENDPOINT = 'https://api.mymemory.translated.net/get';

/** The API rejects queries above 500 bytes. */
const MAX_QUERY_BYTES = 500;

interface MyMemoryResponse {
  responseData?: { translatedText?: string };
  responseStatus?: number | string;
  responseDetails?: string;
  quotaFinished?: boolean;
}

/** MyMemory puts this text where the translation should be when the daily allowance is used up. */
const QUOTA_BANNER = /^MYMEMORY WARNING|YOU USED ALL AVAILABLE FREE TRANSLATIONS/;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** The service sometimes returns HTML entities and stray wrapping quotes. */
function tidy(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/^["'“”„«»\s]+|["'“”„«»\s]+$/gu, '');
}

export interface MyMemoryOptions {
  /** Optional contact e-mail, which raises the daily quota. */
  getEmail: () => string | undefined;
  fetchImpl?: typeof fetch;
}

export class MyMemoryProvider implements MtProvider {
  readonly id = 'mymemory';
  readonly kind = 'mt' as const;
  readonly label = 'MyMemory (no key, basic quality)';
  readonly requiresKey = false;
  readonly contextAware = false;
  readonly requestsPerMinute = 30;
  readonly timeoutMs = 6_000;

  constructor(private readonly options: MyMemoryOptions) {}

  isConfigured(): boolean {
    return true;
  }

  private async translateOne(
    text: string,
    source: LangCode,
    target: LangCode,
    signal: AbortSignal,
  ): Promise<string> {
    if (new TextEncoder().encode(text).byteLength > MAX_QUERY_BYTES) {
      throw new ProviderError(this.id, 'bad_request', 'text is too long for MyMemory (500 bytes)');
    }
    const params = new URLSearchParams({ q: text, langpair: `${source}|${target}` });
    const email = this.options.getEmail();
    if (email) params.set('de', email);

    const response = await httpRequest({
      providerId: this.id,
      method: 'GET',
      url: `${ENDPOINT}?${params.toString()}`,
      signal,
      fetchImpl: this.options.fetchImpl,
    });
    const json = await readJson<MyMemoryResponse>(this.id, response);
    const status = Number(json.responseStatus);
    const translated = tidy(json.responseData?.translatedText ?? '');

    // MyMemory reports quota problems with HTTP 200 and a status / message in the body.
    // Only the service's own banner counts; a translation may well contain the word "limit".
    if (json.quotaFinished === true || status === 429 || QUOTA_BANNER.test(translated)) {
      throw new ProviderError(this.id, 'rate_limit', 'MyMemory daily quota is used up', {
        retryAfterMs: 600_000,
      });
    }
    if (status !== 200 || !translated) {
      throw new ProviderError(this.id, 'bad_response', json.responseDetails || `MyMemory status ${status}`);
    }
    if (!looksLikeLanguage(translated, target)) {
      throw new ProviderError(this.id, 'bad_response', 'MyMemory answered in the wrong script');
    }
    return translated;
  }

  async translate(request: MtRequest): Promise<MtResult> {
    const entries = await Promise.all(
      request.targetLangs.map(
        async (lang) =>
          [lang, await this.translateOne(request.text, request.sourceLang, lang, request.signal)] as const,
      ),
    );
    return { translations: Object.fromEntries(entries) };
  }
}
