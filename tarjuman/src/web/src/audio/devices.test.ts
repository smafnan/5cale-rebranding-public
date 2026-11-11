import { describe, expect, it } from 'vitest';

import { isVirtualDevice } from './devices';

describe('isVirtualDevice', () => {
  it.each([
    'CABLE Input (VB-Audio Virtual Cable)',
    'CABLE Output (VB-Audio Virtual Cable)',
    'CABLE-A Input (VB-Audio Cable A)',
    'VoiceMeeter Input (VB-Audio VoiceMeeter VAIO)',
    'BlackHole 2ch (Virtual)',
    'BlackHole 16ch',
    'Loopback Audio',
    'Soundflower (2ch)',
    'Null Output',
    'Monitor of Null Output',
    'tarjuman-mic',
  ])('recognises "%s" as a virtual cable', (label) => {
    expect(isVirtualDevice(label)).toBe(true);
  });

  it.each([
    'Speakers (Realtek(R) Audio)',
    'Headphones (Jabra Evolve2 65)',
    'MacBook Pro Microphone',
    'Microphone Array (Intel® Smart Sound Technology)',
    'USB-C to 3.5mm Cable Adapter',
    '',
  ])('treats "%s" as a real device', (label) => {
    expect(isVirtualDevice(label)).toBe(false);
  });
});
