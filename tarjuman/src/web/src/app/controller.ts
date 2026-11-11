import { API, type DiagnosticsReport, type KeysResponse } from '../../../shared/api';
import { LANGUAGES, type LangCode } from '../../../shared/languages';
import {
  floatToPcm16,
  LIMITS,
  UTTERANCE_SAMPLE_RATE,
  type AudioUtteranceHeader,
  type ServerMessage,
  type SpeechChunkHeader,
} from '../../../shared/protocol';
import type { ChannelId } from '../../../shared/settings';
import { cancelBrowserSpeech, primeBrowserVoices, speakWithBrowser } from '../audio/browserTts';
import { CaptureChannel } from '../audio/capture';
import { findDevice, listDevices } from '../audio/devices';
import { OutputBus } from '../audio/output';
import { segmenterOptions, type Segment } from '../audio/segmenter';
import {
  describeSourceError,
  openDisplayAudio,
  openInputDevice,
  openMicrophone,
  stopStream,
  type OpenedSource,
  type SourceKind,
} from '../audio/sources';
import { ApiError, apiBytes, apiGet, apiSend, getAccessToken } from '../net/api';
import { ServerConnection } from '../net/connection';
import {
  addEntry,
  dismissNotice,
  mergeDeep,
  patchChannel,
  patchEntry,
  pushNotice,
  removeEntry,
  sanitizeLocalSettings,
  saveSettings,
  useAppStore,
} from '../state/store';
import type {
  AppController,
  ConnectionState,
  DeepPartial,
  LocalSettings,
  TranscriptEntry,
  TranscriptExportFormat,
} from '../state/types';
import { downloadTranscript } from './transcript';

/**
 * The engine behind the UI: owns the audio devices, the server connection and every
 * write to the store. The React components only read the store and call these methods.
 */

type BusId = 'outgoing' | 'incoming' | 'monitor';

/** After translated speech stops, wait this long before listening again (room echo dies down). */
const ECHO_TAIL_MS = 300;

const TEST_PHRASES: Record<LangCode, string> = {
  de: 'Dies ist ein Test. Wenn Sie das hören, funktioniert die Übersetzung.',
  ur: 'یہ ایک ٹیسٹ ہے۔ اگر آپ یہ سن رہے ہیں تو ترجمہ کام کر رہا ہے۔',
  en: 'This is a test. If you can hear this, the translation works.',
};

const STAGE_LABEL = { stt: 'Speech recognition', mt: 'Translation', tts: 'Voice' } as const;

/** A capture gate: while closed, the channel's input is treated as silence. */
interface Gate {
  closed: boolean;
  /** Our own translated speech was audible at some point while the gate was closed. */
  echo: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class Controller implements AppController {
  private initialized = false;
  private readonly connection: ServerConnection;
  private readonly buses: Record<BusId, OutputBus>;
  private readonly captures: Record<ChannelId, CaptureChannel>;
  private readonly sources: Record<ChannelId, OpenedSource | null> = { outgoing: null, incoming: null };
  private readonly busPlaying: Record<BusId, boolean> = { outgoing: false, incoming: false, monitor: false };
  private readonly gates: Record<ChannelId, Gate> = {
    outgoing: { closed: false, echo: false },
    incoming: { closed: false, echo: false },
  };
  /** Utterances sent to the server that have not finished yet. */
  private readonly open = new Map<string, ChannelId>();
  /** Speech chunks received per utterance (decides whether the browser-voice fallback applies). */
  private readonly chunkCounts = new Map<string, number>();
  /** Utterances the user skipped: any speech that still arrives for them is not played. */
  private readonly skipped = new Set<string>();
  /** The settings each running capture was opened with, to notice when they no longer match. */
  private readonly openedWith: Record<ChannelId, string | null> = { outgoing: null, incoming: null };
  /** The browser's own voice (the fallback) is talking on the default speakers. */
  private browserSpeaking = false;
  private pttHeld = false;
  private idCounter = 0;
  private hintedAboutKeys = false;

  constructor() {
    this.connection = new ServerConnection({
      onState: (state) => this.onConnectionState(state),
      onMessage: (message) => this.onMessage(message),
      onSpeech: (header, audio) => this.onSpeech(header, audio),
      getSettings: () => this.settings.session,
    });

    const bus = (id: BusId) =>
      new OutputBus({
        onState: ({ playing, queueMs }) => {
          if (id !== 'monitor') patchChannel(id, { playing, queueMs });
          if (this.busPlaying[id] !== playing) {
            this.busPlaying[id] = playing;
            this.updateGates();
          }
        },
        onInterrupted: () => {
          // The device this bus played on is gone. Choose again (falls back to the default).
          if (id !== 'monitor') void this.applySink(id);
        },
        onUtteranceStart: (utteranceId, atEpochMs) => {
          if (id === 'monitor') return;
          patchEntry(utteranceId, (entry) =>
            entry.latencyMs === null
              ? { latencyMs: Math.max(0, Math.round(atEpochMs - entry.createdAt)) }
              : {},
          );
        },
      });
    this.buses = { outgoing: bus('outgoing'), incoming: bus('incoming'), monitor: bus('monitor') };

    const capture = (channel: ChannelId) =>
      new CaptureChannel(
        {
          onSegment: (segment, endedAt) => this.sendUtterance(channel, segment, endedAt),
          onSpeaking: (speaking) => patchChannel(channel, { speaking }),
          onLevel: (level) => patchChannel(channel, { level }),
        },
        segmenterOptions(this.settings.vadSensitivity, this.settings.pauseMs),
      );
    this.captures = { outgoing: capture('outgoing'), incoming: capture('incoming') };
  }

  private get settings(): LocalSettings {
    return useAppStore.getState().settings;
  }

  // -------------------------------------------------------------------------------------
  // Start-up
  // -------------------------------------------------------------------------------------

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    getAccessToken();

    const s = this.settings;
    this.buses.outgoing.setVolume(s.outgoing.volume);
    this.buses.incoming.setVolume(s.incoming.volume);
    this.buses.monitor.setVolume(s.outgoing.monitorGain);
    this.buses.incoming.setDucking(s.incoming.duckOriginal);
    void this.applySink('outgoing');
    void this.applySink('incoming');

    primeBrowserVoices();
    this.connection.connect();
    navigator.mediaDevices?.addEventListener?.('devicechange', () => void this.onDevicesChanged());
    await this.refreshDevices();
  }

  // -------------------------------------------------------------------------------------
  // Server events
  // -------------------------------------------------------------------------------------

  private onConnectionState(connection: ConnectionState): void {
    useAppStore.setState({ connection });
    if (connection !== 'connected') this.failOpenUtterances('The connection to the server was lost.');
  }

  private onMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'session.ready':
        useAppStore.setState({ server: message.info, providers: message.info.providers });
        return;

      case 'providers.status':
        useAppStore.setState({ providers: message.providers });
        return;

      case 'utterance.transcript':
        patchEntry(message.id, (entry) => ({
          sourceText: message.text,
          status: entry.status === 'transcribing' ? 'translating' : entry.status,
          providers: { ...entry.providers, stt: message.provider },
        }));
        return;

      case 'utterance.translation': {
        const speaks = this.settings.session.channels[message.channel].speak;
        patchEntry(message.id, (entry) => ({
          translations: message.translations,
          status: speaks ? 'speaking' : entry.status,
          providers: { ...entry.providers, mt: message.provider },
        }));
        return;
      }

      case 'utterance.done':
        patchEntry(message.id, { status: 'done', timings: message.timings });
        this.settle(message.id);
        return;

      case 'utterance.dropped': {
        const entry = useAppStore.getState().transcript.find((e) => e.id === message.id);
        if (message.reason === 'cancelled') {
          // Skipped by the user: what was already understood stays on screen, the rest goes.
          if (entry?.sourceText) patchEntry(message.id, { status: 'done' });
          else removeEntry(message.id);
        } else if (entry?.sourceText && !entry.typed) {
          // A rejected transcript stays visible, muted; noise that never produced a word disappears.
          patchEntry(message.id, { status: 'dropped', dropReason: message.reason });
        } else {
          removeEntry(message.id);
        }
        this.settle(message.id);
        return;
      }

      case 'utterance.error':
        this.onUtteranceError(message);
        this.settle(message.id);
        return;

      case 'error':
        pushNotice(
          'error',
          message.code === 'unauthorized'
            ? `The server refused this browser: ${message.message}. Open the link that includes the access token.`
            : message.message,
        );
        return;

      case 'pong':
        return;
    }
  }

  private onUtteranceError(message: Extract<ServerMessage, { type: 'utterance.error' }>): void {
    if (message.stage === 'tts') {
      // The translation is on screen; only the voice is missing.
      patchEntry(message.id, { status: 'done', error: `Voice unavailable: ${message.message}` });
      this.fallbackVoice(message.id);
      return;
    }
    const hint =
      message.code === 'unconfigured'
        ? ' Add a free API key in Settings.'
        : message.code === 'rate_limited'
          ? ' The free-tier limit was reached; try again in a moment.'
          : '';
    patchEntry(message.id, {
      status: 'error',
      error: `${STAGE_LABEL[message.stage]} failed: ${message.message}${hint}`,
    });
    if (message.code === 'unconfigured' && !this.hintedAboutKeys) {
      this.hintedAboutKeys = true;
      pushNotice(
        'warning',
        `${STAGE_LABEL[message.stage]} has no provider yet. Open Settings and add a free API key.`,
      );
    }
  }

  /** Speak a translation with the browser's own voice when the server produced no audio at all. */
  private fallbackVoice(id: string): void {
    if (!this.settings.browserTtsFallback || (this.chunkCounts.get(id) ?? 0) > 0) return;
    const entry = useAppStore.getState().transcript.find((e) => e.id === id);
    const text = entry?.translations[entry.targetLang];
    if (!entry || !text) return;
    // The browser voice always plays on the default speakers. That is right for what I hear,
    // but it would not reach the other side, so do not pretend it does.
    if (entry.channel === 'outgoing' && this.sinkIsVirtual('outgoing')) return;
    const rate = this.settings.session.channels[entry.channel].speechRate;
    speakWithBrowser(text, LANGUAGES[entry.targetLang].locale, rate, (speaking) => {
      // The browser's voice comes out of the loudspeakers like any other translated speech,
      // so it takes part in the echo guard.
      this.browserSpeaking = speaking;
      this.updateGates();
    });
  }

  private onSpeech(header: SpeechChunkHeader, audio: Uint8Array): void {
    if (this.skipped.has(header.id)) return;
    this.chunkCounts.set(header.id, (this.chunkCounts.get(header.id) ?? 0) + 1);
    patchEntry(header.id, (entry) => ({
      status: entry.status === 'done' ? 'done' : 'speaking',
      providers: { ...entry.providers, tts: header.provider },
    }));
    const item = { utteranceId: header.id, index: header.index, bytes: audio };
    this.buses[header.channel].enqueue(item);
    if (header.channel === 'outgoing' && this.settings.outgoing.monitorGain > 0) {
      this.buses.monitor.enqueue(item);
    }
  }

  private settle(id: string): void {
    const channel = this.open.get(id);
    this.chunkCounts.delete(id);
    this.skipped.delete(id);
    if (!channel) return;
    this.open.delete(id);
    this.syncPending(channel);
  }

  private syncPending(channel: ChannelId): void {
    let pending = 0;
    for (const openChannel of this.open.values()) if (openChannel === channel) pending += 1;
    patchChannel(channel, { pending });
  }

  private failOpenUtterances(reason: string): void {
    if (this.open.size === 0) return;
    for (const id of this.open.keys()) {
      patchEntry(id, (entry) =>
        entry.status === 'done' || entry.status === 'dropped' ? {} : { status: 'error', error: reason },
      );
    }
    this.open.clear();
    this.chunkCounts.clear();
    this.skipped.clear();
    this.syncPending('outgoing');
    this.syncPending('incoming');
  }

  // -------------------------------------------------------------------------------------
  // Sending utterances
  // -------------------------------------------------------------------------------------

  private newId(): string {
    this.idCounter += 1;
    return `u${Date.now().toString(36)}_${this.idCounter.toString(36)}`;
  }

  private newEntry(id: string, channel: ChannelId, fields: Partial<TranscriptEntry>): TranscriptEntry {
    const ch = this.settings.session.channels[channel];
    return {
      id,
      channel,
      createdAt: Date.now(),
      typed: false,
      status: 'transcribing',
      sourceLang: ch.sourceLang,
      targetLang: ch.targetLang,
      sourceText: null,
      translations: {},
      audioMs: 0,
      latencyMs: null,
      timings: null,
      providers: {},
      dropReason: null,
      error: null,
      ...fields,
    };
  }

  private sendUtterance(channel: ChannelId, segment: Segment, endedAt: number): void {
    if (!this.connection.connected) {
      pushNotice('warning', 'Not connected to the server, so speech is not being interpreted right now.');
      return;
    }
    const id = this.newId();
    const header: AudioUtteranceHeader = {
      type: 'utterance.audio',
      id,
      channel,
      sampleRate: UTTERANCE_SAMPLE_RATE,
      durationMs: segment.durationMs,
      endedAt,
      forcedSplit: segment.forcedSplit,
      playbackLagMs: this.buses[channel].queueMs,
    };
    if (!this.connection.sendAudio(header, floatToPcm16(segment.samples))) return;
    this.open.set(id, channel);
    addEntry(this.newEntry(id, channel, { createdAt: endedAt, audioMs: segment.durationMs }));
    this.syncPending(channel);
  }

  sendText(channel: ChannelId, rawText: string): void {
    const text = rawText.trim();
    if (!text) return;
    if (text.length > LIMITS.maxTextChars) {
      pushNotice(
        'warning',
        `That is too long to interpret at once (limit ${LIMITS.maxTextChars} characters).`,
      );
      return;
    }
    // Typing is a user action, which is what browsers require before audio may play.
    void this.unlockAudio();
    const id = this.newId();
    if (!this.connection.sendJson({ type: 'utterance.text', id, channel, text })) {
      pushNotice('warning', 'Not connected to the server. The text was not sent.');
      return;
    }
    this.open.set(id, channel);
    addEntry(this.newEntry(id, channel, { typed: true, status: 'translating', sourceText: text }));
    this.syncPending(channel);
  }

  // -------------------------------------------------------------------------------------
  // Capture
  // -------------------------------------------------------------------------------------

  /**
   * Make audio playable (needs the user action that got us here), then route each bus to its
   * configured device. Only now can the browser say whether a saved device is still usable.
   */
  private async unlockAudio(): Promise<void> {
    const buses = [this.buses.outgoing.unlock(), this.buses.incoming.unlock()];
    if (this.settings.outgoing.monitorGain > 0) buses.push(this.buses.monitor.unlock());
    await Promise.all(buses);
    await Promise.all([this.applySink('outgoing'), this.applySink('incoming')]);
  }

  private openSource(channel: ChannelId): { kind: SourceKind; opening: Promise<OpenedSource> } {
    const s = this.settings;
    if (channel === 'outgoing') {
      // With loudspeakers the translated voice reaches the microphone; let the browser cancel it.
      return {
        kind: 'microphone',
        opening: openMicrophone(s.outgoing.micDeviceId, { echoCancellation: !s.headphones }),
      };
    }
    if (s.incoming.sourceKind === 'display') {
      return {
        kind: 'display',
        opening: openDisplayAudio({ suppressLocalAudioPlayback: s.incoming.suppressLocalTabAudio }),
      };
    }
    return { kind: 'device', opening: openInputDevice(s.incoming.deviceId) };
  }

  async startChannel(channel: ChannelId): Promise<void> {
    const current = useAppStore.getState().channels[channel].capture;
    if (current === 'starting' || current === 'capturing') return;
    patchChannel(channel, { capture: 'starting', captureError: null });

    // Both of these need the user's click that got us here, so start them before awaiting anything.
    const unlocking = this.unlockAudio();
    const signature = this.captureSignature(channel);
    const { kind, opening } = this.openSource(channel);

    let source: OpenedSource;
    try {
      source = await opening;
    } catch (error) {
      this.captureFailed(channel, describeSourceError(error, kind));
      return;
    }

    // Fired when the user stops sharing or unplugs the device (not when we stop the track).
    // Listen from the first moment: the source can end while speech detection is still loading.
    const track = source.stream.getAudioTracks()[0];
    const onEnded = () => {
      if (this.sources[channel] !== source) return;
      this.stopChannel(channel);
      pushNotice(
        'warning',
        channel === 'incoming'
          ? 'Audio sharing ended, so the other side is no longer being interpreted.'
          : 'The microphone was disconnected.',
      );
    };
    track?.addEventListener('ended', onEnded);

    try {
      await unlocking;
      await this.captures[channel].start(source.stream);
    } catch (error) {
      stopStream(source.stream);
      this.captureFailed(channel, `Voice detection could not start: ${errorMessage(error)}`);
      return;
    }

    this.sources[channel] = source;
    this.openedWith[channel] = signature;
    if (track?.readyState === 'ended') {
      onEnded();
      return;
    }

    patchChannel(channel, { capture: 'capturing', captureError: null, sourceLabel: source.label });
    this.applyPassthrough();
    this.updateGates();
    // Device names become visible once any audio permission has been granted.
    void this.refreshDevices();
    // The device or processing settings may have been changed while this start was under way.
    if (this.captureSignature(channel) !== signature) void this.restartChannel(channel);
  }

  /**
   * The settings a capture depends on, as one comparable value. A screen or tab share has
   * none: it cannot be reopened without a click, so it is never restarted automatically.
   */
  private captureSignature(channel: ChannelId): string {
    const s = this.settings;
    if (channel === 'outgoing') return `mic:${s.outgoing.micDeviceId}:${s.headphones ? 'raw' : 'aec'}`;
    return s.incoming.sourceKind === 'device' ? `device:${s.incoming.deviceId}` : 'display';
  }

  private captureFailed(channel: ChannelId, message: string): void {
    patchChannel(channel, {
      capture: 'error',
      captureError: message,
      sourceLabel: null,
      speaking: false,
      level: 0,
    });
    pushNotice('error', message);
  }

  stopChannel(channel: ChannelId): void {
    const source = this.sources[channel];
    this.sources[channel] = null;
    this.openedWith[channel] = null;
    void this.captures[channel].stop();
    if (source) stopStream(source.stream);
    if (channel === 'outgoing') this.pttHeld = false;
    patchChannel(channel, {
      capture: 'idle',
      captureError: null,
      sourceLabel: null,
      speaking: false,
      level: 0,
      pttHeld: false,
      replaysOriginal: false,
    });
    this.applyPassthrough();
    this.updateGates();
  }

  /** Reopen a running capture after its device or processing settings changed. */
  private async restartChannel(channel: ChannelId): Promise<void> {
    if (!this.sources[channel]) return;
    this.stopChannel(channel);
    await this.startChannel(channel);
  }

  setPushToTalk(held: boolean): void {
    if (this.settings.outgoing.micMode !== 'push-to-talk' || this.pttHeld === held) return;
    this.pttHeld = held;
    patchChannel('outgoing', { pttHeld: held });
    this.updateGates();
    // Releasing the key means "I am done": send it now instead of waiting for the pause timeout.
    if (!held) this.captures.outgoing.flush();
  }

  // -------------------------------------------------------------------------------------
  // Mixing and echo control
  // -------------------------------------------------------------------------------------

  private sinkIsVirtual(channel: ChannelId): boolean {
    const sinkId = this.settings[channel].sinkId;
    if (!sinkId) return false;
    return findDevice(useAppStore.getState().devices.outputs, sinkId)?.virtual ?? false;
  }

  /** Decide which original voices are mixed under the translations. */
  private applyPassthrough(): void {
    const s = this.settings;

    // My own voice, quietly, under the translation the other side hears. Only into a virtual
    // cable: on real loudspeakers it would feed straight back into the microphone.
    const mic = this.sources.outgoing;
    const micUnder = mic !== null && s.outgoing.passthroughGain > 0 && this.sinkIsVirtual('outgoing');
    this.buses.outgoing.setPassthrough(micUnder ? mic.stream : null);
    this.buses.outgoing.setPassthroughLevel(s.outgoing.passthroughGain);

    // Their original voice under the translation I hear. Only when I would not hear it otherwise:
    // the captured tab is muted, or the call plays into a virtual cable.
    const theirs = this.sources.incoming;
    let replay = false;
    if (theirs) {
      const fromVirtualCable =
        theirs.kind === 'device' &&
        (findDevice(useAppStore.getState().devices.inputs, s.incoming.deviceId)?.virtual ?? false);
      replay = theirs.suppressesLocalPlayback || fromVirtualCable;
    }
    this.buses.incoming.setPassthrough(replay && theirs ? theirs.stream : null);
    this.buses.incoming.setPassthroughLevel(s.incoming.originalGain);
    this.buses.incoming.setDucking(s.incoming.duckOriginal);
    patchChannel('incoming', { replaysOriginal: replay });
  }

  /**
   * Close a channel's gate whenever listening would capture our own translated speech,
   * and (for the microphone) while push-to-talk is not held.
   */
  private updateGates(): void {
    const s = this.settings;
    // Translated speech that is audible in the room right now.
    const outgoingAudible = this.busPlaying.outgoing && !this.sinkIsVirtual('outgoing');
    const audible =
      this.busPlaying.incoming || this.busPlaying.monitor || outgoingAudible || this.browserSpeaking;

    const pushToTalk = s.outgoing.micMode === 'push-to-talk';
    const micEcho = !s.headphones && audible;
    this.setGate('outgoing', (pushToTalk && !this.pttHeld) || micEcho, micEcho);

    // Capturing the whole system's audio also captures what this page plays.
    const source = this.sources.incoming;
    const selfCapture = source !== null && !source.excludesOwnAudio;
    const loop = selfCapture && audible;
    this.setGate('incoming', loop, loop);
  }

  /**
   * Closing takes effect at once. Reopening after an echo closure keeps the input ignored
   * a moment longer, so the tail of the translated speech still ringing in the room is not
   * picked up.
   */
  private setGate(channel: ChannelId, closed: boolean, becauseOfEcho: boolean): void {
    const gate = this.gates[channel];
    if (closed) {
      gate.echo = gate.echo || becauseOfEcho;
    } else if (!gate.closed) {
      return;
    }
    const delay = !closed && gate.echo ? ECHO_TAIL_MS : 0;
    if (!closed) gate.echo = false;
    gate.closed = closed;
    this.captures[channel].setGate(closed, delay);
    patchChannel(channel, { gated: closed });
  }

  flushPlayback(channel: ChannelId): void {
    // "Skip to live": drop what is queued here, and tell the server to stop working on
    // everything of this channel that is still on its way.
    for (const [id, openChannel] of this.open) {
      if (openChannel !== channel) continue;
      this.skipped.add(id);
      this.connection.sendJson({ type: 'utterance.cancel', id });
    }
    this.buses[channel].flush();
    if (channel === 'outgoing') this.buses.monitor.flush();
    cancelBrowserSpeech();
  }

  // -------------------------------------------------------------------------------------
  // Settings and devices
  // -------------------------------------------------------------------------------------

  updateSettings(patch: DeepPartial<LocalSettings>): void {
    const previous = this.settings;
    const next = sanitizeLocalSettings(mergeDeep(previous, patch));
    useAppStore.setState({ settings: next });
    saveSettings(next);
    this.applySettings(previous, next);
  }

  private applySettings(previous: LocalSettings, next: LocalSettings): void {
    if (JSON.stringify(previous.session) !== JSON.stringify(next.session)) {
      this.connection.sendJson({ type: 'session.update', settings: next.session });
    }

    if (previous.outgoing.sinkId !== next.outgoing.sinkId) void this.applySink('outgoing');
    if (previous.incoming.sinkId !== next.incoming.sinkId) void this.applySink('incoming');

    this.buses.outgoing.setVolume(next.outgoing.volume);
    this.buses.incoming.setVolume(next.incoming.volume);
    this.buses.monitor.setVolume(next.outgoing.monitorGain);
    if (next.outgoing.monitorGain > 0 && previous.outgoing.monitorGain === 0)
      void this.buses.monitor.unlock();

    if (previous.vadSensitivity !== next.vadSensitivity || previous.pauseMs !== next.pauseMs) {
      const options = segmenterOptions(next.vadSensitivity, next.pauseMs);
      this.captures.outgoing.setSegmenterOptions(options);
      this.captures.incoming.setSegmenterOptions(options);
    }

    if (previous.outgoing.micMode !== next.outgoing.micMode) {
      this.pttHeld = false;
      patchChannel('outgoing', { pttHeld: false });
    }

    // A different microphone or line-in device, or a change in echo cancellation, needs the
    // stream reopened. A capture that is still starting notices the change itself when it is up.
    for (const channel of ['outgoing', 'incoming'] as const) {
      const openedWith = this.openedWith[channel];
      if (openedWith !== null && openedWith !== 'display' && openedWith !== this.captureSignature(channel)) {
        void this.restartChannel(channel);
      }
    }

    this.applyPassthrough();
    this.updateGates();
  }

  /** Route a channel's translated speech (and, for incoming, the monitor) to its configured device. */
  private async applySink(channel: ChannelId): Promise<void> {
    const sinkId = this.settings[channel].sinkId;
    const devices = useAppStore.getState().devices;
    // A saved device that is not plugged in today cannot be used; say so instead of playing
    // silently somewhere else. (Before device names are visible we cannot tell, and let the browser decide.)
    const missing = sinkId !== '' && devices.labelsAvailable && !findDevice(devices.outputs, sinkId);
    let ok = !missing && (await this.buses[channel].setSink(sinkId));
    if (!ok) await this.buses[channel].setSink('');
    if (channel === 'incoming') await this.buses.monitor.setSink(ok ? sinkId : '');
    // Settings may have changed again while the browser was switching devices.
    if (this.settings[channel].sinkId !== sinkId) return;
    if (sinkId === '') ok = true;
    patchChannel(channel, { sinkOk: ok, sinkLabel: this.sinkLabel(sinkId) });
    this.applyPassthrough();
    this.updateGates();
  }

  /** A device was plugged in or removed: refresh the lists and re-route, falling back or returning as needed. */
  private async onDevicesChanged(): Promise<void> {
    await this.refreshDevices();
    await Promise.all([this.applySink('outgoing'), this.applySink('incoming')]);
  }

  private sinkLabel(sinkId: string): string {
    if (!sinkId) return 'System default';
    return findDevice(useAppStore.getState().devices.outputs, sinkId)?.label ?? 'Unknown device';
  }

  swapLanguages(): void {
    const { outgoing, incoming } = this.settings.session.channels;
    this.updateSettings({
      session: {
        channels: {
          outgoing: { sourceLang: incoming.sourceLang, targetLang: outgoing.sourceLang, voice: 'auto' },
          incoming: { sourceLang: outgoing.sourceLang, targetLang: incoming.sourceLang, voice: 'auto' },
        },
      },
    });
  }

  async unlockDeviceLabels(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stopStream(stream);
    } catch (error) {
      pushNotice('error', describeSourceError(error, 'microphone'));
    }
    await this.refreshDevices();
  }

  async refreshDevices(): Promise<void> {
    try {
      const devices = await listDevices();
      useAppStore.setState({ devices });
    } catch {
      // Device enumeration is best effort; the selectors simply stay as they were.
      return;
    }
    patchChannel('outgoing', { sinkLabel: this.sinkLabel(this.settings.outgoing.sinkId) });
    patchChannel('incoming', { sinkLabel: this.sinkLabel(this.settings.incoming.sinkId) });
    // Whether a device is a virtual cable feeds into mixing and echo decisions.
    this.applyPassthrough();
    this.updateGates();
  }

  async playTestPhrase(channel: ChannelId): Promise<void> {
    const unlocking = this.unlockAudio();
    const ch = this.settings.session.channels[channel];
    try {
      await unlocking;
      const bytes = await apiBytes(API.tts, {
        text: TEST_PHRASES[ch.targetLang],
        lang: ch.targetLang,
        voice: ch.voice,
        rate: ch.speechRate,
      });
      this.buses[channel].enqueue({ utteranceId: this.newId(), index: 0, bytes });
      pushNotice('info', `Playing a test phrase on: ${this.sinkLabel(this.settings[channel].sinkId)}`);
    } catch (error) {
      pushNotice('error', `Could not play the test phrase: ${errorMessage(error)}`);
    }
  }

  // -------------------------------------------------------------------------------------
  // Transcript, keys, diagnostics
  // -------------------------------------------------------------------------------------

  clearTranscript(): void {
    useAppStore.setState({ transcript: [] });
  }

  exportTranscript(format: TranscriptExportFormat): void {
    const transcript = useAppStore.getState().transcript;
    if (!transcript.some((entry) => entry.sourceText)) {
      pushNotice('info', 'There is nothing to export yet.');
      return;
    }
    downloadTranscript(transcript, format);
  }

  resetContext(): void {
    if (this.connection.sendJson({ type: 'session.reset' })) {
      pushNotice('success', 'Started a new topic: earlier sentences are no longer used as context.');
    }
  }

  getKeys(): Promise<KeysResponse> {
    return apiGet<KeysResponse>(API.keys);
  }

  async saveKeys(keys: Record<string, string | null>): Promise<KeysResponse> {
    const response = await apiSend<KeysResponse>('PUT', API.keys, { keys });
    useAppStore.setState({ server: response.info, providers: response.info.providers });
    this.hintedAboutKeys = false;
    return response;
  }

  async runDiagnostics(): Promise<DiagnosticsReport> {
    try {
      return await apiSend<DiagnosticsReport>('POST', API.diagnostics);
    } catch (error) {
      if (error instanceof ApiError) pushNotice('error', `The provider test could not run: ${error.message}`);
      throw error;
    }
  }

  dismissNotice(id: string): void {
    dismissNotice(id);
  }
}

export function createController(): AppController {
  return new Controller();
}
