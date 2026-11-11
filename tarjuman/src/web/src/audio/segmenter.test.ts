import { describe, expect, it } from 'vitest';

import { Segmenter, segmenterOptions, type Segment, type SegmenterOptions } from './segmenter';

const FRAME_SAMPLES = 512; // 32 ms at 16 kHz
const FRAME_MS = 32;

function harness(overrides: Partial<SegmenterOptions> = {}) {
  const segments: Segment[] = [];
  const events: string[] = [];
  const options = { ...segmenterOptions('normal', 640), ...overrides };
  const segmenter = new Segmenter(options, {
    onSpeechStart: () => events.push('start'),
    onSpeechEnd: () => events.push('end'),
    onSegment: (segment) => segments.push(segment),
  });
  let counter = 0;
  /** Feed `ms` of audio at a constant speech probability. Each frame is filled with its index. */
  const feed = (ms: number, probability: number) => {
    for (let i = 0; i < Math.round(ms / FRAME_MS); i++) {
      segmenter.push(new Float32Array(FRAME_SAMPLES).fill(++counter), probability);
    }
  };
  return { segmenter, segments, events, feed, options };
}

describe('Segmenter', () => {
  it('emits one utterance per stretch of speech, ended by a pause', () => {
    const { segments, events, feed } = harness();
    feed(500, 0.02);
    feed(1600, 0.95);
    feed(800, 0.02);
    expect(events).toEqual(['start', 'end']);
    expect(segments).toHaveLength(1);
    const segment = segments[0]!;
    expect(segment.forcedSplit).toBe(false);
    // speech + pre-roll + a short tail, but not the whole closing pause
    expect(segment.durationMs).toBeGreaterThan(1600 + 250);
    expect(segment.durationMs).toBeLessThan(1600 + 320 + 320);
  });

  it('keeps audio from just before the first speech frame (pre-roll)', () => {
    const { segments, feed } = harness();
    feed(1000, 0.02); // frames 1..31
    feed(960, 0.95);
    feed(800, 0.02);
    const first = segments[0]!.samples[0]!;
    // 320 ms of pre-roll = 10 frames before the first speech frame (frame 32)
    expect(first).toBe(22);
  });

  it('does not end an utterance on a pause shorter than pauseMs', () => {
    const { segments, feed } = harness();
    feed(800, 0.95);
    feed(400, 0.02); // shorter than 640 ms
    feed(800, 0.95);
    feed(800, 0.02);
    expect(segments).toHaveLength(1);
  });

  it('treats probabilities between the two thresholds as speech once an utterance runs (hysteresis)', () => {
    const { segments, feed } = harness();
    feed(600, 0.9);
    feed(1500, 0.4); // above endThreshold (0.35), below startThreshold (0.5)
    expect(segments).toHaveLength(0);
    feed(800, 0.02);
    expect(segments).toHaveLength(1);
  });

  it('never starts an utterance from probabilities below the start threshold', () => {
    const { segments, events, feed } = harness();
    feed(3000, 0.45);
    expect(events).toEqual([]);
    expect(segments).toHaveLength(0);
  });

  it('discards blips with too little speech', () => {
    const { segments, events, feed } = harness();
    feed(128, 0.95); // 4 frames, below minSpeechMs
    feed(800, 0.02);
    expect(events).toEqual(['start', 'end']);
    expect(segments).toHaveLength(0);
  });

  it('accepts a short breath as the end once the speaker has talked for softMaxMs', () => {
    const { segments, feed } = harness();
    feed(9500, 0.95);
    feed(288, 0.02); // 9 frames: longer than softPauseMs (260), far shorter than pauseMs (640)
    expect(segments).toHaveLength(1);
    expect(segments[0]!.forcedSplit).toBe(false);
  });

  it('splits a monologue at the quietest recent frame when hardMaxMs is reached, and keeps going', () => {
    const { segments, events, feed, segmenter } = harness();
    feed(13_500, 0.95);
    feed(64, 0.4); // a dip that is not silence
    feed(1_500, 0.95); // crosses 15 s
    expect(segments).toHaveLength(1);
    expect(segments[0]!.forcedSplit).toBe(true);
    // Cut at the dip, not at the 15 s mark.
    expect(segments[0]!.durationMs).toBeGreaterThan(13_400);
    expect(segments[0]!.durationMs).toBeLessThan(14_000);
    // Still inside the same stretch of speech: no "end" event, and the rest follows.
    expect(events).toEqual(['start']);
    expect(segmenter.speaking).toBe(true);
    feed(800, 0.02);
    expect(segments).toHaveLength(2);
    expect(segments[1]!.forcedSplit).toBe(false);
    expect(events).toEqual(['start', 'end']);
  });

  it('loses no audio across a forced split', () => {
    const { segments, feed } = harness({ preRollMs: 0, tailPadMs: 10_000 });
    feed(16_000, 0.95);
    feed(800, 0.02);
    const total = segments.reduce((sum, s) => sum + s.samples.length, 0);
    // All 16 s of speech plus the 640 ms pause that ended the utterance (the tail is kept in full here).
    expect(total).toBe(Math.round((16_000 + 640) / FRAME_MS) * FRAME_SAMPLES);
    // Frame markers continue without a gap from one segment into the next.
    const lastOfFirst = segments[0]!.samples.at(-1)!;
    expect(segments[1]!.samples[0]).toBe(lastOfFirst + 1);
  });

  it('flush() ends the running utterance immediately', () => {
    const { segments, events, feed, segmenter } = harness();
    feed(700, 0.95);
    segmenter.flush();
    expect(segments).toHaveLength(1);
    expect(events).toEqual(['start', 'end']);
    segmenter.flush(); // nothing running: no effect
    expect(segments).toHaveLength(1);
  });

  it('reset() discards the running utterance', () => {
    const { segments, events, feed, segmenter } = harness();
    feed(700, 0.95);
    segmenter.reset();
    feed(800, 0.02);
    expect(segments).toHaveLength(0);
    expect(events).toEqual(['start', 'end']);
  });

  it('copies frames, so the caller may reuse its buffer', () => {
    const segments: Segment[] = [];
    const segmenter = new Segmenter(segmenterOptions('normal', 640), {
      onSpeechStart: () => undefined,
      onSpeechEnd: () => undefined,
      onSegment: (segment) => segments.push(segment),
    });
    const shared = new Float32Array(FRAME_SAMPLES);
    for (let i = 0; i < 30; i++) {
      shared.fill(i + 1);
      segmenter.push(shared, 0.95);
    }
    segmenter.flush();
    expect(segments[0]!.samples[0]).toBe(1);
    expect(segments[0]!.samples.at(-1)).toBe(30);
  });

  it('applies new options to the running stream', () => {
    const { segments, feed, segmenter, options } = harness();
    feed(800, 0.95);
    segmenter.setOptions({ ...options, pauseMs: 320 });
    feed(352, 0.02);
    expect(segments).toHaveLength(1);
  });

  it('is more eager with higher sensitivity', () => {
    const low = segmenterOptions('low', 640);
    const high = segmenterOptions('high', 640);
    expect(high.startThreshold).toBeLessThan(low.startThreshold);
    expect(high.endThreshold).toBeLessThan(low.endThreshold);
  });
});
