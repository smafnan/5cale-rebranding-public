import type { MicVAD } from '@ricky0123/vad-web';

import { Segmenter, type Segment, type SegmenterOptions } from './segmenter';

/**
 * Listens to one audio stream and turns it into utterances.
 *
 * Voice activity comes from the Silero VAD neural model (run in the browser through
 * ONNX Runtime Web); the `Segmenter` turns its per-frame speech probabilities into
 * utterances. Only audio that contains speech ever leaves the browser, which is what
 * keeps the free speech-recognition quotas sufficient for real meetings.
 */

/** Where Vite copies the model, the audio worklet and the ONNX runtime (see vite.config.ts). */
const VAD_ASSET_PATH = '/vad/';

/** Level meter updates per second. */
const LEVEL_INTERVAL_MS = 100;

export interface CaptureCallbacks {
  /** A complete utterance. `endedAt` is the wall-clock time (epoch ms) at which it ended. */
  onSegment(segment: Segment, endedAt: number): void;
  onSpeaking(speaking: boolean): void;
  /** Input level 0..1 (perceptual scale), at most every 100 ms. */
  onLevel(level: number): void;
}

/** Map RMS amplitude to a 0..1 meter value over a 60 dB range. */
export function meterLevel(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

export class CaptureChannel {
  private vad: MicVAD | null = null;
  private readonly segmenter: Segmenter;
  private gateClosed = false;
  /** performance.now() until which input is still ignored after the gate reopened. */
  private mutedUntil = 0;
  private peak = 0;
  private lastLevelAt = 0;

  constructor(
    private readonly callbacks: CaptureCallbacks,
    options: SegmenterOptions,
  ) {
    this.segmenter = new Segmenter(options, {
      onSpeechStart: () => callbacks.onSpeaking(true),
      onSpeechEnd: () => callbacks.onSpeaking(false),
      onSegment: (segment) => callbacks.onSegment(segment, Date.now()),
    });
  }

  get running(): boolean {
    return this.vad !== null;
  }

  /**
   * Start listening to `stream`. The stream stays owned by the caller (it is not stopped here).
   * @throws when the voice-detection model or audio worklet cannot be loaded.
   */
  async start(stream: MediaStream): Promise<void> {
    await this.stop();
    // Loaded on first use: the detector and its ONNX runtime are most of the page's JavaScript.
    const { MicVAD } = await import('@ricky0123/vad-web');
    const vad = await MicVAD.new({
      model: 'v5',
      baseAssetPath: VAD_ASSET_PATH,
      onnxWASMBasePath: VAD_ASSET_PATH,
      startOnLoad: false,
      getStream: async () => stream,
      // The library must never stop or replace a stream it does not own.
      pauseStream: async () => undefined,
      resumeStream: async () => stream,
      // We only want the per-frame probabilities. These values make the library's own
      // utterance detection inert, so it does not buffer audio alongside our segmenter.
      positiveSpeechThreshold: 1,
      negativeSpeechThreshold: 1,
      redemptionMs: 0,
      preSpeechPadMs: 0,
      minSpeechMs: 0,
      onFrameProcessed: (probabilities, frame) => this.onFrame(frame, probabilities.isSpeech),
    });
    await vad.start();
    this.vad = vad;
  }

  async stop(): Promise<void> {
    const vad = this.vad;
    this.vad = null;
    // Send what was being said when capture stopped rather than losing it.
    this.segmenter.flush();
    this.segmenter.reset();
    this.callbacks.onLevel(0);
    if (vad) await vad.destroy().catch(() => undefined);
  }

  /**
   * While the gate is closed the input is treated as silence: a running utterance ends
   * normally and no new one starts. Used for the echo guard and for push-to-talk.
   *
   * `reopenDelayMs` keeps the input ignored for a little longer after reopening (room echo).
   * It is measured against the audio frames themselves rather than with a timer, because
   * browsers slow timers to once a second or less while the window is hidden behind Teams.
   */
  setGate(closed: boolean, reopenDelayMs = 0): void {
    if (this.gateClosed && !closed) this.mutedUntil = performance.now() + reopenDelayMs;
    this.gateClosed = closed;
  }

  /** End the current utterance immediately (push-to-talk released). */
  flush(): void {
    this.segmenter.flush();
  }

  setSegmenterOptions(options: SegmenterOptions): void {
    this.segmenter.setOptions(options);
  }

  private onFrame(frame: Float32Array, speechProbability: number): void {
    if (!this.vad) return;
    const ignored = this.gateClosed || performance.now() < this.mutedUntil;
    this.segmenter.push(frame, ignored ? 0 : speechProbability);

    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      const sample = frame[i] ?? 0;
      sum += sample * sample;
    }
    this.peak = Math.max(this.peak, Math.sqrt(sum / Math.max(1, frame.length)));
    const now = performance.now();
    if (now - this.lastLevelAt >= LEVEL_INTERVAL_MS) {
      this.lastLevelAt = now;
      this.callbacks.onLevel(meterLevel(this.peak));
      this.peak = 0;
    }
  }
}
