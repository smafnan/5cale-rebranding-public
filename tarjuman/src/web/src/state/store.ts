import { create } from 'zustand';

import { DEFAULT_SESSION_SETTINGS, sanitizeSessionSettings, type ChannelId } from '../../../shared/settings';
import {
  PAUSE_MS_MAX,
  PAUSE_MS_MIN,
  type AppState,
  type ChannelRuntime,
  type DeepPartial,
  type LocalSettings,
  type Notice,
  type NoticeLevel,
  type TranscriptEntry,
} from './types';

const STORAGE_KEY = 'tarjuman.settings.v1';

/** Keep the transcript bounded so a day-long session cannot exhaust memory. */
export const MAX_TRANSCRIPT_ENTRIES = 500;
const MAX_NOTICES = 4;

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  version: 1,
  session: DEFAULT_SESSION_SETTINGS,
  outgoing: {
    micDeviceId: '',
    sinkId: '',
    micMode: 'auto',
    passthroughGain: 0,
    monitorGain: 0,
    volume: 1,
  },
  incoming: {
    sourceKind: 'display',
    deviceId: '',
    sinkId: '',
    originalGain: 0.25,
    duckOriginal: true,
    suppressLocalTabAudio: false,
    volume: 1,
  },
  headphones: true,
  vadSensitivity: 'normal',
  pauseMs: 650,
  browserTtsFallback: true,
  ui: { theme: 'system', urduFont: 'nastaliq', captionScale: 1 },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Recursively merge `patch` into `base` without mutating either. Arrays are replaced, not merged. */
export function mergeDeep<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (patch === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = mergeDeep(out[key], value as DeepPartial<unknown>);
  }
  return out as T;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Turn anything (old localStorage content, a partial patch result) into valid settings. */
export function sanitizeLocalSettings(input: unknown): LocalSettings {
  const d = DEFAULT_LOCAL_SETTINGS;
  const raw = isPlainObject(input) ? input : {};
  const out = isPlainObject(raw.outgoing) ? raw.outgoing : {};
  const inc = isPlainObject(raw.incoming) ? raw.incoming : {};
  const ui = isPlainObject(raw.ui) ? raw.ui : {};
  return {
    version: 1,
    session: sanitizeSessionSettings(raw.session ?? d.session),
    outgoing: {
      micDeviceId: str(out.micDeviceId, d.outgoing.micDeviceId),
      sinkId: str(out.sinkId, d.outgoing.sinkId),
      micMode: oneOf(out.micMode, ['auto', 'push-to-talk'] as const, d.outgoing.micMode),
      passthroughGain: num(out.passthroughGain, d.outgoing.passthroughGain, 0, 1),
      monitorGain: num(out.monitorGain, d.outgoing.monitorGain, 0, 1),
      volume: num(out.volume, d.outgoing.volume, 0, 1.5),
    },
    incoming: {
      sourceKind: oneOf(inc.sourceKind, ['display', 'device'] as const, d.incoming.sourceKind),
      deviceId: str(inc.deviceId, d.incoming.deviceId),
      sinkId: str(inc.sinkId, d.incoming.sinkId),
      originalGain: num(inc.originalGain, d.incoming.originalGain, 0, 1),
      duckOriginal: bool(inc.duckOriginal, d.incoming.duckOriginal),
      suppressLocalTabAudio: bool(inc.suppressLocalTabAudio, d.incoming.suppressLocalTabAudio),
      volume: num(inc.volume, d.incoming.volume, 0, 1.5),
    },
    headphones: bool(raw.headphones, d.headphones),
    vadSensitivity: oneOf(raw.vadSensitivity, ['low', 'normal', 'high'] as const, d.vadSensitivity),
    pauseMs: num(raw.pauseMs, d.pauseMs, PAUSE_MS_MIN, PAUSE_MS_MAX),
    browserTtsFallback: bool(raw.browserTtsFallback, d.browserTtsFallback),
    ui: {
      theme: oneOf(ui.theme, ['system', 'light', 'dark'] as const, d.ui.theme),
      urduFont: oneOf(ui.urduFont, ['nastaliq', 'naskh'] as const, d.ui.urduFont),
      captionScale: num(ui.captionScale, d.ui.captionScale, 0.85, 1.6),
    },
  };
}

export function loadSettings(): LocalSettings {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) return sanitizeLocalSettings(JSON.parse(raw));
  } catch {
    // Corrupt or inaccessible storage: fall through to defaults.
  }
  return sanitizeLocalSettings(undefined);
}

export function saveSettings(settings: LocalSettings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode, quota). Settings then last for this page load only.
  }
}

export function initialChannelRuntime(): ChannelRuntime {
  return {
    capture: 'idle',
    captureError: null,
    sourceLabel: null,
    speaking: false,
    gated: false,
    pttHeld: false,
    level: 0,
    playing: false,
    queueMs: 0,
    pending: 0,
    replaysOriginal: false,
    sinkLabel: null,
    sinkOk: true,
  };
}

export function initialState(): AppState {
  return {
    settings: loadSettings(),
    connection: 'connecting',
    server: null,
    providers: { stt: [], mt: [], tts: [] },
    channels: { outgoing: initialChannelRuntime(), incoming: initialChannelRuntime() },
    transcript: [],
    devices: {
      inputs: [],
      outputs: [],
      labelsAvailable: false,
      canChooseOutput: false,
      canCaptureDisplayAudio: false,
    },
    notices: [],
  };
}

/** The single store. The UI reads it with `useAppStore(selector)`; only the engine writes. */
export const useAppStore = create<AppState>(() => initialState());

// ---------------------------------------------------------------------------------------
// Mutators used by the engine. Kept here so every state transition is in one place.
// ---------------------------------------------------------------------------------------

export function patchChannel(channel: ChannelId, patch: Partial<ChannelRuntime>): void {
  useAppStore.setState((state) => {
    const current = state.channels[channel];
    let changed = false;
    for (const key of Object.keys(patch) as (keyof ChannelRuntime)[]) {
      if (current[key] !== patch[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return state;
    return { channels: { ...state.channels, [channel]: { ...current, ...patch } } };
  });
}

export function addEntry(entry: TranscriptEntry): void {
  useAppStore.setState((state) => {
    const transcript = [...state.transcript, entry];
    if (transcript.length > MAX_TRANSCRIPT_ENTRIES)
      transcript.splice(0, transcript.length - MAX_TRANSCRIPT_ENTRIES);
    return { transcript };
  });
}

/** Update one entry. `patch` may be a function of the current entry. Unknown ids are ignored. */
export function patchEntry(
  id: string,
  patch: Partial<TranscriptEntry> | ((entry: TranscriptEntry) => Partial<TranscriptEntry>),
): void {
  useAppStore.setState((state) => {
    const index = state.transcript.findIndex((entry) => entry.id === id);
    const current = state.transcript[index];
    if (!current) return state;
    const next = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
    const transcript = state.transcript.slice();
    transcript[index] = next;
    return { transcript };
  });
}

export function removeEntry(id: string): void {
  useAppStore.setState((state) => ({ transcript: state.transcript.filter((entry) => entry.id !== id) }));
}

let noticeCounter = 0;

export function pushNotice(level: NoticeLevel, message: string): string {
  const notice: Notice = { id: `n${++noticeCounter}`, level, message, at: Date.now() };
  useAppStore.setState((state) => {
    // Do not stack identical messages (e.g. repeated rate-limit errors).
    const notices = state.notices.filter((existing) => existing.message !== message);
    notices.push(notice);
    return { notices: notices.slice(-MAX_NOTICES) };
  });
  return notice.id;
}

export function dismissNotice(id: string): void {
  useAppStore.setState((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) }));
}
