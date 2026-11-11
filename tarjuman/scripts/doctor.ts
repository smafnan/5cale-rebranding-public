import 'dotenv/config';

import type { DiagnosticResult } from '../src/shared/api';
import type { ProviderKind } from '../src/shared/protocol';
import { ConfigError, loadConfig } from '../src/server/config';
import { createServices } from '../src/server/services';

/**
 * `npm run doctor` — checks the setup from the command line: which keys are present,
 * and whether every provider actually answers. Sends one small real request per
 * configured provider. Exit code 0 when speech recognition, translation and voice each
 * have at least one working provider.
 *
 *   npm run doctor            human-readable report
 *   npm run doctor -- --json  the raw report
 */

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number, text: string) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const green = (text: string) => paint(32, text);
const red = (text: string) => paint(31, text);
const dim = (text: string) => paint(2, text);
const bold = (text: string) => paint(1, text);

const KIND_TITLE: Record<ProviderKind, string> = {
  stt: 'Speech recognition',
  mt: 'Translation',
  tts: 'Voice',
};

const MARK: Record<DiagnosticResult['outcome'], string> = {
  ok: green('OK  '),
  failed: red('FAIL'),
  skipped: dim('skip'),
};

const ADVICE: Record<ProviderKind, string> = {
  stt: 'add GROQ_API_KEY (free, https://console.groq.com/keys) to .env or under Settings in the app',
  mt: 'add GROQ_API_KEY or GEMINI_API_KEY (both free) to .env or under Settings in the app',
  tts: 'the keyless Edge voices need outbound access to speech.platform.bing.com; alternatively set AZURE_SPEECH_KEY',
};

async function main(): Promise<number> {
  const json = process.argv.includes('--json');
  const config = loadConfig();
  const services = await createServices(config);

  if (!json) {
    console.log(bold('\nKeys'));
    for (const key of services.keys.status()) {
      const state = key.set ? green(`set (${key.source === 'env' ? 'environment' : 'saved in the app'}, ${key.hint})`) : dim('not set');
      console.log(`  ${key.name.padEnd(24)} ${state}`);
    }
    if (config.mock) console.log(dim('\n  TARJUMAN_MOCK is on: every provider below is an offline fake.'));
    console.log(dim('\nTesting providers (one small request each)…'));
  }

  const report = await services.diagnose();
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  }

  const kinds: ProviderKind[] = ['stt', 'mt', 'tts'];
  const missing: ProviderKind[] = [];
  for (const kind of kinds) {
    const results = report.results.filter((result) => result.kind === kind);
    if (!results.some((result) => result.outcome === 'ok')) missing.push(kind);
    if (json) continue;
    console.log(bold(`\n${KIND_TITLE[kind]}`));
    const width = Math.max(...results.map((result) => result.label.length));
    for (const result of results) {
      const time = result.outcome === 'skipped' ? '' : `${String(result.ms).padStart(5)} ms  `;
      console.log(`  ${MARK[result.outcome]}  ${result.label.padEnd(width)}  ${dim(time)}${result.detail}`);
    }
  }

  if (!json) {
    console.log('');
    if (missing.length === 0) {
      console.log(green('Everything needed for a call is working.'));
    } else {
      for (const kind of missing) {
        console.log(red(`${KIND_TITLE[kind]} has no working provider: `) + ADVICE[kind] + '.');
      }
    }
    console.log('');
  }
  return missing.length === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof ConfigError ? `\n${error.message}\n` : error);
    process.exit(1);
  });
