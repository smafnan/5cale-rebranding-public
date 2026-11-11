/**
 * Browser-side state model. This file is the contract between the engine
 * (audio + network + controller) and the React UI:
 *
 * - the engine is the only writer of `AppState` (through `store.ts`)
 * - the UI only reads `AppState` and calls methods on `AppController`
 */

import type { DiagnosticsReport, KeysResponse } from '../../../shared/api';
import type { LangCode } from '../../../shared/languages';
import type {
  DropReason,
  ProviderKind,
  ProviderStatus,
  ServerInfo,
  UtteranceTimings,
} from '../../../shared/protocol';
import type { ChannelId, SessionSettings } from '../../../shared/settings';

// ---------------------------------------------------------------------------------------
// Persisted local settings (localStorage)
// ---------------------------------------------------------------------------------------

/** How the microphone decides when you are speaking. */
export type MicMode = 'auto' | 'push-to-talk';

/**
 * Where the other side's voice is captured from.
 * - `display`: the browser's screen-share picker (a Teams browser tab, or system audio)
 * - `device`: an audio input device, typically a virtual cable that Teams plays into
 */
export type IncomingSourceKind = 'display' | 'device';

export type VadSensitivity = 'low' | 'normal' | 'high';

export interface OutgoingLocalSettings {
  /** Microphone device id, '' = system default. */
  micDeviceId: string;
  /** Output device for the translated voice (the virtual microphone), '' = system default. */
  sinkId: string;
  micMode: MicMode;
  /** 0..1 — your own voice mixed quietly under the translation that the other side hears. */
  passthroughGain: number;
  /** 0..1 — how loudly you hear your own outgoing translation in your headphones. */
  monitorGain: number;
  /** 0..1.5 — volume of the translated voice. */
  volume: number;
}

export interface IncomingLocalSettings {
  sourceKind: IncomingSourceKind;
  /** Input device id when `sourceKind` is `device`, '' = system default. */
  deviceId: string;
  /** Output device for the translated voice (your headphones), '' = system default. */
  sinkId: string;
  /** 0..1 — volume of the original voice when Tarjuman replays it (see `ChannelRuntime.replaysOriginal`). */
  originalGain: number;
  /** Lower the original voice while the translation is being spoken. */
  duckOriginal: boolean;
  /** For browser-tab capture: mute the tab itself so the original is only heard through Tarjuman's mix. */
  suppressLocalTabAudio: boolean;
  /** 0..1.5 — volume of the translated voice. */
  volume: number;
}

export interface UiSettings {
  theme: 'system' | 'light' | 'dark';
  /** Typeface for Urdu captions. Nastaliq is the traditional Urdu style; Naskh is more compact. */
  urduFont: 'nastaliq' | 'naskh';
  /** Caption size multiplier, 0.85..1.6. */
  captionScale: number;
}

export interface LocalSettings {
  /** Version of this schema, for migrations of persisted data. */
  version: 1;
  /** The part that is sent to the server. */
  session: SessionSettings;
  outgoing: OutgoingLocalSettings;
  incoming: IncomingLocalSettings;
  /**
   * True when translated audio only reaches your ears (headset). When false the microphone
   * is paused while translated speech plays, so the translation is not re-translated.
   */
  headphones: boolean;
  vadSensitivity: VadSensitivity;
  /** Silence in ms that ends an utterance. Lower = faster but cuts sentences more often. */
  pauseMs: number;
  /** Use the browser's built-in voice when the server cannot synthesize speech. */
  browserTtsFallback: boolean;
  ui: UiSettings;
}

export const PAUSE_MS_MIN = 350;
export const PAUSE_MS_MAX = 1500;

// ---------------------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------------------

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export type CaptureState = 'idle' | 'starting' | 'capturing' | 'error';

export interface ChannelRuntime {
  capture: CaptureState;
  /** Why capture failed or stopped unexpectedly (permission denied, sharing ended, ...). */
  captureError: string | null;
  /** Label of what is being captured ("Jabra Evolve2", "Tab: Microsoft Teams", "System audio"). */
  sourceLabel: string | null;
  /** Voice activity detected right now. */
  speaking: boolean;
  /** True while capture is deliberately ignored (echo guard, push-to-talk not held). */
  gated: boolean;
  /** Push-to-talk key or button currently held (outgoing channel only). */
  pttHeld: boolean;
  /** Input level 0..1 for the meter (smoothed, updated ~10x per second). */
  level: number;
  /** Translated speech for this channel is playing. */
  playing: boolean;
  /** Translated speech queued or playing, in ms. */
  queueMs: number;
  /** Utterances sent to the server and not yet finished. */
  pending: number;
  /** True when Tarjuman replays the original voice in its own mix (incoming channel only). */
  replaysOriginal: boolean;
  /** Label of the device translated speech is routed to. */
  sinkLabel: string | null;
  /** False when the chosen output device could not be selected and the default is used. */
  sinkOk: boolean;
}

export type EntryStatus = 'transcribing' | 'translating' | 'speaking' | 'done' | 'dropped' | 'error';

export interface TranscriptEntry {
  id: string;
  channel: ChannelId;
  /** Epoch ms: end of speech, or when the text was submitted. */
  createdAt: number;
  /** True when typed instead of spoken. */
  typed: boolean;
  status: EntryStatus;
  sourceLang: LangCode;
  targetLang: LangCode;
  /** Original words. Null until speech-to-text has finished. */
  sourceText: string | null;
  translations: Partial<Record<LangCode, string>>;
  /** Duration of the spoken audio in ms (0 for typed text). */
  audioMs: number;
  /** End of speech -> translated voice starts playing, in ms. Null until known. */
  latencyMs: number | null;
  timings: UtteranceTimings | null;
  providers: Partial<Record<ProviderKind, string>>;
  dropReason: DropReason | null;
  /** Human-readable problem for `error` status, or a non-fatal note (e.g. voice unavailable). */
  error: string | null;
}

export interface AudioDevice {
  deviceId: string;
  label: string;
  /** Matches a known virtual audio cable (VB-CABLE, VoiceMeeter, BlackHole, Loopback, null sink). */
  virtual: boolean;
}

export interface DeviceState {
  inputs: AudioDevice[];
  outputs: AudioDevice[];
  /** False until microphone permission is granted (labels are hidden before that). */
  labelsAvailable: boolean;
  /** False in browsers that cannot route audio to a chosen output device. */
  canChooseOutput: boolean;
  /** False in browsers without screen-share audio capture. */
  canCaptureDisplayAudio: boolean;
}

export type NoticeLevel = 'info' | 'success' | 'warning' | 'error';

export interface Notice {
  id: string;
  level: NoticeLevel;
  message: string;
  /** Epoch ms. */
  at: number;
}

export interface AppState {
  settings: LocalSettings;
  connection: ConnectionState;
  /** Null until the server has been reached once. */
  server: ServerInfo | null;
  providers: Record<ProviderKind, ProviderStatus[]>;
  channels: Record<ChannelId, ChannelRuntime>;
  /** Oldest first. */
  transcript: TranscriptEntry[];
  devices: DeviceState;
  /** Transient messages shown as toasts, newest last. */
  notices: Notice[];
}

// ---------------------------------------------------------------------------------------
// Controller: every action the UI can trigger
// ---------------------------------------------------------------------------------------

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type TranscriptExportFormat = 'markdown' | 'json' | 'text';

export interface AppController {
  /** Connect to the server and load devices. Safe to call once on page load. */
  init(): Promise<void>;

  /**
   * Start capturing a channel. MUST be called from a click handler: it opens the
   * microphone / screen-share prompt and unlocks audio playback.
   * Never rejects; failures are reported in `channels[channel].captureError` and a notice.
   */
  startChannel(channel: ChannelId): Promise<void>;
  stopChannel(channel: ChannelId): void;

  /** Push-to-talk: call with true on press and false on release (outgoing channel). */
  setPushToTalk(held: boolean): void;

  /** Interpret typed text as if it had been spoken on `channel`. */
  sendText(channel: ChannelId, text: string): void;

  /** Merge a patch into the local settings, persist it, and apply it live (devices, volumes, server session). */
  updateSettings(patch: DeepPartial<LocalSettings>): void;
  /** Swap who speaks which language (outgoing ur->de / incoming de->ur becomes the reverse). */
  swapLanguages(): void;

  /** Ask for microphone permission so device names become visible, then refresh the device list. */
  unlockDeviceLabels(): Promise<void>;
  refreshDevices(): Promise<void>;

  /** Stop and discard translated speech that is queued or playing ("skip to live"). */
  flushPlayback(channel: ChannelId): void;

  /**
   * Synthesize a short phrase in the channel's target language and play it on the channel's
   * output device. Used by the setup guide to verify routing. Must be called from a click handler.
   */
  playTestPhrase(channel: ChannelId): Promise<void>;

  clearTranscript(): void;
  /** Download the transcript as a file. */
  exportTranscript(format: TranscriptExportFormat): void;
  /** Forget the conversation context kept by the server (start of a new topic or meeting). */
  resetContext(): void;

  getKeys(): Promise<KeysResponse>;
  saveKeys(keys: Record<string, string | null>): Promise<KeysResponse>;
  runDiagnostics(): Promise<DiagnosticsReport>;

  dismissNotice(id: string): void;
}
