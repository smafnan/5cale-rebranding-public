/**
 * One output device with everything that plays on it: the queue of translated speech and,
 * optionally, an "original voice" stream mixed underneath.
 *
 * There is one bus per destination:
 *   outgoing bus -> virtual microphone (what the other side hears)
 *   incoming bus -> headphones (what I hear)
 *   monitor bus  -> headphones (a quiet copy of my own outgoing translation)
 */

export interface OutputState {
  playing: boolean;
  /** Translated speech still queued or playing, in ms. */
  queueMs: number;
}

export interface OutputCallbacks {
  onState(state: OutputState): void;
  /** First audio of an utterance is about to be heard. `atEpochMs` is when playback starts. */
  onUtteranceStart?(utteranceId: string, atEpochMs: number): void;
}

export interface SpeechItem {
  utteranceId: string;
  /** Position within the utterance; 0 marks the start of a new utterance. */
  index: number;
  /** A complete encoded audio file (MP3 / WAV). */
  bytes: Uint8Array;
}

/** Pause between two utterances, and between two sentences of one utterance, in seconds. */
const UTTERANCE_GAP_S = 0.14;
const SENTENCE_GAP_S = 0.03;
/** Small lead so scheduling never lands in the past. */
const SCHEDULE_LEAD_S = 0.03;
/** Level of the original voice while translated speech is playing over it. */
const DUCKED_LEVEL = 0.3;

type SinkAudioContext = AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };
type SinkAudioElement = HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> };

export class OutputBus {
  private context: SinkAudioContext | null = null;
  private speechGain: GainNode | null = null;
  private passthroughGain: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private passthroughSource: MediaStreamAudioSourceNode | null = null;
  /** Fallback route for browsers without AudioContext.setSinkId. */
  private element: SinkAudioElement | null = null;

  private readonly sources = new Set<AudioBufferSourceNode>();
  /** Context time at which the queue runs dry. */
  private queueEnd = 0;
  /** Bumped by flush(); audio decoded for an older generation is discarded. */
  private generation = 0;
  private decodeChain: Promise<void> = Promise.resolve();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private lastPlaying = false;

  private sinkId = '';
  private volume = 1;
  private passthroughLevel = 0;
  private ducking = false;
  private passthroughStream: MediaStream | null = null;

  constructor(private readonly callbacks: OutputCallbacks) {}

  get playing(): boolean {
    return this.context !== null && this.queueEnd > this.context.currentTime + 0.01;
  }

  get queueMs(): number {
    if (!this.context) return 0;
    return Math.max(0, Math.round((this.queueEnd - this.context.currentTime) * 1000));
  }

  /**
   * Create the audio graph if needed and make sure it is running. Browsers only allow this
   * as a result of a user action, so call it from click / key handlers.
   */
  async unlock(): Promise<void> {
    if (!this.context) this.build();
    const context = this.context;
    if (context && context.state === 'suspended') await context.resume().catch(() => undefined);
    if (this.element?.paused) await this.element.play().catch(() => undefined);
  }

  private build(): void {
    const context: SinkAudioContext = new AudioContext({ latencyHint: 'interactive' });
    const master = context.createGain();
    const speechGain = context.createGain();
    const passthroughGain = context.createGain();
    const duckGain = context.createGain();
    speechGain.gain.value = this.volume;
    passthroughGain.gain.value = this.passthroughLevel;
    speechGain.connect(master);
    passthroughGain.connect(duckGain).connect(master);

    if (typeof context.setSinkId === 'function') {
      master.connect(context.destination);
    } else {
      // Older browsers can only route an <audio> element to a device, so play through one.
      const destination = context.createMediaStreamDestination();
      master.connect(destination);
      const element: SinkAudioElement = new Audio();
      element.srcObject = destination.stream;
      element.autoplay = true;
      this.element = element;
    }

    this.context = context;
    this.speechGain = speechGain;
    this.passthroughGain = passthroughGain;
    this.duckGain = duckGain;
    if (this.sinkId) void this.applySink();
    if (this.passthroughStream) this.connectPassthrough();
  }

  private async applySink(): Promise<boolean> {
    try {
      if (this.context && typeof this.context.setSinkId === 'function') {
        await this.context.setSinkId(this.sinkId);
      } else if (this.element && typeof this.element.setSinkId === 'function') {
        await this.element.setSinkId(this.sinkId);
      } else if (this.sinkId) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Route this bus to an output device ('' = system default).
   * Resolves to false when the device could not be selected; audio then stays where it was.
   */
  async setSink(sinkId: string): Promise<boolean> {
    this.sinkId = sinkId;
    if (!this.context) return true; // applied when the graph is built
    return this.applySink();
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.speechGain && this.context) {
      this.speechGain.gain.setTargetAtTime(volume, this.context.currentTime, 0.02);
    }
  }

  /** Mix a live stream (the original voice) underneath the translated speech, or remove it with null. */
  setPassthrough(stream: MediaStream | null): void {
    this.passthroughStream = stream;
    if (this.context) this.connectPassthrough();
  }

  private connectPassthrough(): void {
    this.passthroughSource?.disconnect();
    this.passthroughSource = null;
    if (!this.context || !this.passthroughGain || !this.passthroughStream) return;
    if (this.passthroughStream.getAudioTracks().length === 0) return;
    this.passthroughSource = this.context.createMediaStreamSource(this.passthroughStream);
    this.passthroughSource.connect(this.passthroughGain);
  }

  setPassthroughLevel(level: number): void {
    this.passthroughLevel = level;
    if (this.passthroughGain && this.context) {
      this.passthroughGain.gain.setTargetAtTime(level, this.context.currentTime, 0.03);
    }
  }

  /** Lower the original voice while translated speech is playing. */
  setDucking(enabled: boolean): void {
    this.ducking = enabled;
    this.applyDucking();
  }

  private applyDucking(): void {
    if (!this.duckGain || !this.context) return;
    const target = this.ducking && this.playing ? DUCKED_LEVEL : 1;
    this.duckGain.gain.setTargetAtTime(target, this.context.currentTime, this.playing ? 0.05 : 0.2);
  }

  /** Queue one chunk of translated speech. Chunks play in the order they are enqueued. */
  enqueue(item: SpeechItem): void {
    const generation = this.generation;
    this.decodeChain = this.decodeChain
      .then(async () => {
        if (!this.context) this.build();
        const context = this.context;
        if (!context || generation !== this.generation) return;
        // decodeAudioData detaches the buffer it is given, so hand it a private copy.
        const copy = item.bytes.buffer.slice(item.bytes.byteOffset, item.bytes.byteOffset + item.bytes.byteLength);
        const buffer = await context.decodeAudioData(copy as ArrayBuffer);
        if (generation !== this.generation) return;
        this.schedule(context, buffer, item);
      })
      .catch((error: unknown) => {
        console.warn('could not play a speech chunk', error);
      });
  }

  private schedule(context: AudioContext, buffer: AudioBuffer, item: SpeechItem): void {
    if (!this.speechGain) return;
    const now = context.currentTime;
    const queued = this.queueEnd > now;
    const gap = queued ? (item.index === 0 ? UTTERANCE_GAP_S : SENTENCE_GAP_S) : 0;
    const startAt = Math.max(now + SCHEDULE_LEAD_S, this.queueEnd + gap);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.speechGain);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      this.report();
    };
    source.start(startAt);
    this.sources.add(source);
    this.queueEnd = startAt + buffer.duration;

    if (item.index === 0) {
      const outputLatency = Number.isFinite(context.outputLatency) ? context.outputLatency : 0;
      this.callbacks.onUtteranceStart?.(item.utteranceId, Date.now() + (startAt - now + outputLatency) * 1000);
    }
    this.report();
  }

  /** Stop and discard everything queued or playing ("skip to live"). */
  flush(): void {
    this.generation += 1;
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      source.disconnect();
    }
    this.sources.clear();
    this.queueEnd = 0;
    this.report();
  }

  private report(): void {
    const playing = this.playing;
    if (playing !== this.lastPlaying) {
      this.lastPlaying = playing;
      this.applyDucking();
    }
    this.callbacks.onState({ playing, queueMs: this.queueMs });

    // While audio is queued, keep the reported queue length current.
    if (playing && !this.ticker) {
      this.ticker = setInterval(() => this.report(), 250);
    } else if (!playing && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  close(): void {
    this.flush();
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.passthroughSource?.disconnect();
    this.element?.pause();
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
