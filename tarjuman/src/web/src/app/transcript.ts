import { LANGUAGES, type LangCode } from '../../../shared/languages';
import type { TranscriptEntry, TranscriptExportFormat } from '../state/types';

/**
 * Turning the on-screen transcript into a file the user can keep (meeting notes).
 */

const SPEAKER = { outgoing: 'Me', incoming: 'Them' } as const;

function clock(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Entries worth exporting: something was said and understood. */
function exportable(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  return entries.filter((entry) => entry.sourceText && entry.status !== 'dropped');
}

/** Languages of an entry in reading order: what was said, what it was translated to, then the rest. */
function languagesOf(entry: TranscriptEntry): LangCode[] {
  const langs: LangCode[] = [entry.sourceLang];
  if (entry.translations[entry.targetLang]) langs.push(entry.targetLang);
  for (const lang of Object.keys(entry.translations) as LangCode[]) {
    if (!langs.includes(lang) && entry.translations[lang]) langs.push(lang);
  }
  return langs;
}

function textIn(entry: TranscriptEntry, lang: LangCode): string {
  return lang === entry.sourceLang ? (entry.sourceText ?? '') : (entry.translations[lang] ?? '');
}

export function formatTranscript(
  entries: readonly TranscriptEntry[],
  format: TranscriptExportFormat,
): string {
  const list = exportable(entries);

  if (format === 'json') {
    return JSON.stringify(
      list.map((entry) => ({
        time: new Date(entry.createdAt).toISOString(),
        speaker: SPEAKER[entry.channel],
        language: entry.sourceLang,
        text: entry.sourceText,
        translations: entry.translations,
      })),
      null,
      2,
    );
  }

  if (format === 'text') {
    return list
      .map((entry) => {
        const lines = languagesOf(entry).map((lang) => `  [${lang}] ${textIn(entry, lang)}`);
        return `${clock(entry.createdAt)} ${SPEAKER[entry.channel]}\n${lines.join('\n')}`;
      })
      .join('\n\n');
  }

  const first = list[0];
  const title = first
    ? `# Meeting transcript — ${new Date(first.createdAt).toLocaleDateString()}`
    : '# Meeting transcript';
  const body = list.map((entry) => {
    const lines = languagesOf(entry).map((lang) => `- **${LANGUAGES[lang].name}:** ${textIn(entry, lang)}`);
    return `**${clock(entry.createdAt)} · ${SPEAKER[entry.channel]}**\n${lines.join('\n')}`;
  });
  return `${[title, ...body].join('\n\n')}\n`;
}

const EXTENSION: Record<TranscriptExportFormat, string> = { markdown: 'md', json: 'json', text: 'txt' };
const MIME: Record<TranscriptExportFormat, string> = {
  markdown: 'text/markdown',
  json: 'application/json',
  text: 'text/plain',
};

export function transcriptFileName(format: TranscriptExportFormat, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `tarjuman-transcript-${stamp}.${EXTENSION[format]}`;
}

/** Offer the transcript as a download. */
export function downloadTranscript(
  entries: readonly TranscriptEntry[],
  format: TranscriptExportFormat,
): void {
  const blob = new Blob([formatTranscript(entries, format)], { type: `${MIME[format]};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = transcriptFileName(format);
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the URL is revoked.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
