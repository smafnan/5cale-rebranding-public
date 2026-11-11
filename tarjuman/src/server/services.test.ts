import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from './config';
import { createServices, selectProviders } from './services';

const dirs: string[] = [];

async function services(env: Record<string, string>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tarjuman-services-'));
  dirs.push(dir);
  const fullEnv = { DATA_DIR: dir, ...env };
  return createServices(loadConfig(fullEnv, dir), fullEnv);
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const ids = (providers: readonly { id: string }[]) => providers.map((provider) => provider.id);

describe('provider selection', () => {
  const all = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never[];

  it('uses every provider in default order without a list', () => {
    expect(selectProviders(all, undefined)).toEqual({ providers: all, unknown: [] });
    expect(selectProviders(all, [])).toEqual({ providers: all, unknown: [] });
  });

  it('treats a list as exclusive and reports ids it does not know', () => {
    const selection = selectProviders(all as { id: string }[] as never[], ['c', 'nope', 'a', 'c']);
    expect(ids(selection.providers)).toEqual(['c', 'a']);
    expect(selection.unknown).toEqual(['nope']);
  });
});

describe('createServices', () => {
  it('wires the default chains: Gemini and Whisper for speech, LLMs then MyMemory for text, Azure then Edge for voice', async () => {
    const s = await services({});
    expect(ids(s.chains.stt.providers)).toEqual([
      'gemini-audio',
      'groq-whisper-large-v3',
      'groq-whisper-large-v3-turbo',
    ]);
    expect(ids(s.chains.mt.providers)).toEqual([
      'gemini-flash-lite',
      'gemma',
      'groq-gpt-oss-120b',
      'groq-qwen3-8-27b',
      'groq-gpt-oss-20b',
      'custom',
      'mymemory',
    ]);
    expect(ids(s.chains.tts.providers)).toEqual(['azure', 'edge']);
    expect(s.warnings).toEqual([]);
  });

  it('prefers the multimodal recognizer for Urdu and Whisper for German', async () => {
    const s = await services({});
    const order = (lang: 'ur' | 'de') =>
      [...s.chains.stt.providers]
        .sort((a, b) => s.chains.sttRank(a, lang) - s.chains.sttRank(b, lang))
        .map((p) => p.id);
    expect(order('ur')[0]).toBe('gemini-audio');
    expect(order('de')).toEqual(['groq-whisper-large-v3', 'groq-whisper-large-v3-turbo', 'gemini-audio']);
  });

  it('keeps a "local translator only" setup local: no other translator is in the chain', async () => {
    const s = await services({
      OPENAI_COMPAT_BASE_URL: 'http://localhost:11434/v1',
      OPENAI_COMPAT_MODEL: 'gemma3:12b',
      MT_PROVIDERS: 'custom',
      STT_PROVIDERS: 'groq-whisper-large-v3',
      GROQ_API_KEY: 'gsk_test',
    });
    expect(ids(s.chains.mt.providers)).toEqual(['custom']);
    expect(ids(s.chains.stt.providers)).toEqual(['groq-whisper-large-v3']);
    expect(s.providerStatus().mt).toMatchObject([{ id: 'custom', state: 'ready' }]);
  });

  it('warns about provider ids that do not exist instead of silently ignoring them', async () => {
    const s = await services({ MT_PROVIDERS: 'groq-llama-3.3-70b,mymemory' });
    expect(ids(s.chains.mt.providers)).toEqual(['mymemory']);
    expect(s.warnings).toHaveLength(1);
    expect(s.warnings[0]).toContain('MT_PROVIDERS');
    expect(s.warnings[0]).toContain('groq-llama-3.3-70b');
  });

  it('follows the configured Groq model lists', async () => {
    const s = await services({ GROQ_MT_MODELS: 'vendor/New-Model_2', GROQ_STT_MODELS: 'whisper-next' });
    expect(ids(s.chains.mt.providers)).toContain('groq-new-model-2');
    expect(ids(s.chains.stt.providers)).toEqual(['gemini-audio', 'groq-whisper-next']);
  });

  it('uses only the offline fakes in mock mode, whatever lists are configured', async () => {
    const s = await services({ TARJUMAN_MOCK: '1', MT_PROVIDERS: 'custom' });
    expect(ids(s.chains.mt.providers)).toEqual(['mock-mt']);
    expect(s.warnings).toEqual([]);
  });
});
