import { describe, expect, it } from 'vitest';

import {
  bytesToPcm16,
  decodeBinaryFrame,
  encodeBinaryFrame,
  floatToPcm16,
  LIMITS,
  pcm16ToBytes,
  pcm16ToWav,
  ProtocolError,
  type AudioUtteranceHeader,
  type SpeechChunkHeader,
} from './protocol';

const audioHeader: AudioUtteranceHeader = {
  type: 'utterance.audio',
  id: 'u-1',
  channel: 'outgoing',
  sampleRate: 16_000,
  durationMs: 1_000,
  endedAt: 1_762_823_456_789,
  forcedSplit: false,
  playbackLagMs: 0,
};

/** Build a raw frame from arbitrary header bytes, bypassing the encoder's own checks. */
function rawFrame(headerBytes: Uint8Array, declaredLength = headerBytes.byteLength, payload = new Uint8Array(0)) {
  const frame = new Uint8Array(4 + headerBytes.byteLength + payload.byteLength);
  new DataView(frame.buffer).setUint32(0, declaredLength, false);
  frame.set(headerBytes, 4);
  frame.set(payload, 4 + headerBytes.byteLength);
  return frame;
}

describe('binary framing', () => {
  it('round-trips header and payload', () => {
    const payload = new Uint8Array([1, 2, 3, 250, 251, 252]);
    const decoded = decodeBinaryFrame(encodeBinaryFrame(audioHeader, payload));
    expect(decoded.header).toEqual(audioHeader);
    expect([...decoded.payload]).toEqual([...payload]);
  });

  it('round-trips non-ASCII header text (the byte length is what counts, not the string length)', () => {
    const header: SpeechChunkHeader = {
      type: 'utterance.speech',
      id: 'u-2',
      channel: 'incoming',
      lang: 'ur',
      index: 0,
      last: true,
      mime: 'audio/mpeg',
      text: 'السلام علیکم، کیا آپ مجھے سن سکتے ہیں؟ — „Grüße“ 🎧',
      provider: 'edge',
      voice: 'ur-PK-UzmaNeural',
    };
    const decoded = decodeBinaryFrame(encodeBinaryFrame(header, new Uint8Array([9])));
    expect(decoded.header).toEqual(header);
    expect([...decoded.payload]).toEqual([9]);
  });

  it('writes the header length as a big-endian uint32 prefix', () => {
    const frame = encodeBinaryFrame(audioHeader, new Uint8Array(0));
    const headerLength = new TextEncoder().encode(JSON.stringify(audioHeader)).byteLength;
    expect([...frame.subarray(0, 4)]).toEqual([0, 0, headerLength >> 8, headerLength & 0xff]);
    expect(frame.byteLength).toBe(4 + headerLength);
  });

  it('accepts an empty payload', () => {
    const decoded = decodeBinaryFrame(encodeBinaryFrame(audioHeader, new Uint8Array(0)));
    expect(decoded.payload.byteLength).toBe(0);
  });

  it('decodes a frame that is a view into a larger buffer (non-zero byteOffset)', () => {
    const frame = encodeBinaryFrame(audioHeader, new Uint8Array([7, 8, 9]));
    const padded = new Uint8Array(frame.byteLength + 13);
    padded.fill(0xff);
    padded.set(frame, 5);
    const decoded = decodeBinaryFrame(padded.subarray(5, 5 + frame.byteLength));
    expect(decoded.header).toEqual(audioHeader);
    expect([...decoded.payload]).toEqual([7, 8, 9]);
  });

  it('returns the payload as a view, without copying', () => {
    const frame = encodeBinaryFrame(audioHeader, new Uint8Array([1, 2, 3]));
    const decoded = decodeBinaryFrame(frame);
    expect(decoded.payload.buffer).toBe(frame.buffer);
  });

  it('refuses to encode a header above the size cap', () => {
    const header = { ...audioHeader, id: 'x'.repeat(LIMITS.maxHeaderBytes) };
    expect(() => encodeBinaryFrame(header, new Uint8Array(0))).toThrow(ProtocolError);
  });

  it('rejects frames shorter than the length prefix', () => {
    expect(() => decodeBinaryFrame(new Uint8Array(0))).toThrow(ProtocolError);
    expect(() => decodeBinaryFrame(new Uint8Array([0, 0, 1]))).toThrow(/shorter than its length prefix/);
  });

  it('rejects a zero header length', () => {
    expect(() => decodeBinaryFrame(new Uint8Array([0, 0, 0, 0, 1, 2]))).toThrow(/invalid binary frame header length 0/);
  });

  it('rejects a declared header length above the cap without reading further', () => {
    const frame = rawFrame(new Uint8Array(8), LIMITS.maxHeaderBytes + 1);
    expect(() => decodeBinaryFrame(frame)).toThrow(/invalid binary frame header length/);
    // A length prefix of 0xFFFFFFFF must not be read as a negative number.
    expect(() => decodeBinaryFrame(new Uint8Array([0xff, 0xff, 0xff, 0xff, 1]))).toThrow(ProtocolError);
  });

  it('rejects a truncated header', () => {
    const frame = encodeBinaryFrame(audioHeader, new Uint8Array(0));
    expect(() => decodeBinaryFrame(frame.subarray(0, frame.byteLength - 1))).toThrow(/truncated/);
  });

  it('rejects a header that is not JSON', () => {
    const frame = rawFrame(new TextEncoder().encode('not json at all'));
    expect(() => decodeBinaryFrame(frame)).toThrow(/not valid UTF-8 JSON/);
  });

  it('rejects a header that is not valid UTF-8', () => {
    const frame = rawFrame(new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]));
    expect(() => decodeBinaryFrame(frame)).toThrow(/not valid UTF-8 JSON/);
  });

  it('hands back whatever JSON the header contains, for the caller to validate', () => {
    const frame = rawFrame(new TextEncoder().encode('[1,2,3]'), undefined, new Uint8Array([5]));
    const decoded = decodeBinaryFrame(frame);
    expect(decoded.header).toEqual([1, 2, 3]);
    expect([...decoded.payload]).toEqual([5]);
  });
});

describe('floatToPcm16', () => {
  it('maps the full float range onto the full 16-bit range', () => {
    expect([...floatToPcm16(new Float32Array([0, 1, -1, 0.5, -0.5]))]).toEqual([0, 32767, -32768, 16384, -16384]);
  });

  it('clips samples outside [-1, 1] instead of wrapping around', () => {
    expect([...floatToPcm16(new Float32Array([1.7, -1.7, 100, -100, Infinity, -Infinity]))]).toEqual([
      32767, -32768, 32767, -32768, 32767, -32768,
    ]);
  });

  it('returns an empty array for no input', () => {
    expect(floatToPcm16(new Float32Array(0)).length).toBe(0);
  });
});

describe('pcm16ToWav', () => {
  it('writes a canonical 44-byte mono 16-bit PCM header', () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768]);
    const wav = pcm16ToWav(pcm, 16_000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const ascii = (offset: number) => String.fromCharCode(...wav.subarray(offset, offset + 4));

    expect(wav.byteLength).toBe(44 + 10);
    expect(ascii(0)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 10);
    expect(ascii(8)).toBe('WAVE');
    expect(ascii(12)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(ascii(36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(10);
    expect([0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true))).toEqual([...pcm]);
  });

  it('uses the given sample rate for the rate fields', () => {
    const view = new DataView(pcm16ToWav(new Int16Array(4), 24_000).buffer);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint32(28, true)).toBe(48_000);
  });

  it('produces a valid header for empty audio', () => {
    const wav = pcm16ToWav(new Int16Array(0), 16_000);
    const view = new DataView(wav.buffer);
    expect(wav.byteLength).toBe(44);
    expect(view.getUint32(4, true)).toBe(36);
    expect(view.getUint32(40, true)).toBe(0);
  });
});

describe('bytesToPcm16 / pcm16ToBytes', () => {
  it('round-trips samples as little-endian bytes', () => {
    const pcm = new Int16Array([0, 1, -1, 258, -32768, 32767]);
    const bytes = pcm16ToBytes(pcm);
    expect([...bytes.subarray(6, 8)]).toEqual([0x02, 0x01]); // 258 = 0x0102, low byte first
    expect([...bytesToPcm16(bytes)]).toEqual([...pcm]);
  });

  it('ignores a trailing odd byte', () => {
    expect([...bytesToPcm16(new Uint8Array([0x34, 0x12, 0x99]))]).toEqual([0x1234]);
    expect(bytesToPcm16(new Uint8Array([0x99])).length).toBe(0);
    expect(bytesToPcm16(new Uint8Array(0)).length).toBe(0);
  });

  it('reads from a view with an odd, non-zero byteOffset', () => {
    const backing = new Uint8Array([0xaa, 0xbb, 0xcc, 0x01, 0x00, 0xff, 0xff, 0x7f, 0xdd]);
    const view = backing.subarray(3, 8); // 01 00 | ff ff | 7f (odd tail)
    expect([...bytesToPcm16(view)]).toEqual([1, -1]);
  });

  it('copies, so the result does not alias the input', () => {
    const bytes = new Uint8Array([1, 0, 2, 0]);
    const pcm = bytesToPcm16(bytes);
    bytes[0] = 99;
    expect([...pcm]).toEqual([1, 2]);
  });

  it('survives the payload of a decoded frame', () => {
    const pcm = new Int16Array([10, -20, 30]);
    const frame = encodeBinaryFrame(audioHeader, pcm16ToBytes(pcm));
    expect([...bytesToPcm16(decodeBinaryFrame(frame).payload)]).toEqual([...pcm]);
  });
});
