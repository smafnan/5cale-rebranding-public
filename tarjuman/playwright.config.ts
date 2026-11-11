import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { defineConfig } from '@playwright/test';

const PORT = 8799;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * End-to-end tests run the real server (with the offline mock providers) and a real
 * Chromium whose "microphone" is a recording of two German sentences. That exercises
 * everything between the microphone and the loudspeaker: speech detection, the socket
 * protocol, the pipeline, audio decoding and playback scheduling.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    permissions: ['microphone'],
    launchOptions: {
      args: [
        // Grant media permissions without a prompt and feed the recording as the microphone.
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${path.resolve(import.meta.dirname, 'tests/e2e/fixtures/two-sentences-de.wav')}`,
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'npm run build && npm start',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      TARJUMAN_MOCK: '1',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: mkdtempSync(path.join(tmpdir(), 'tarjuman-e2e-')),
      LOG_LEVEL: 'warn',
    },
  },
});
