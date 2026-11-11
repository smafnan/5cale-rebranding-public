import type { AudioDevice, DeviceState } from '../state/types';

/**
 * Audio device discovery and the heuristics for recognising virtual audio cables.
 */

/**
 * Labels of the virtual cables people use to feed audio into meeting apps:
 * VB-CABLE / VoiceMeeter (Windows), BlackHole / Loopback / Soundflower (macOS),
 * null sinks (Linux PipeWire / PulseAudio), and the names from our own setup guide.
 *
 * Deliberately a list of known cables rather than "anything called virtual": meeting apps
 * install private loopback devices ("Microsoft Teams Audio (Virtual)", "ZoomAudioDevice")
 * and headsets advertise "virtual surround"; none of those carry audio into a call.
 */
const VIRTUAL_CABLE_PATTERN =
  /vb-audio|vb-cable|\bcable[- ]?(input|output|in|out|[ab])\b|voicemeeter|blackhole|loopback audio|soundflower|null[- ]?(sink|output)|tarjuman/i;

const NOT_A_CABLE_PATTERN = /\bteams\b|zoom|surround/i;

export function isVirtualDevice(label: string): boolean {
  return VIRTUAL_CABLE_PATTERN.test(label) && !NOT_A_CABLE_PATTERN.test(label);
}

/** Pseudo-devices that duplicate a real one; we offer our own "System default" entry instead. */
const PSEUDO_DEVICE_IDS = new Set(['default', 'communications']);

function toAudioDevice(info: MediaDeviceInfo, index: number, noun: string): AudioDevice {
  const label = info.label || `${noun} ${index + 1}`;
  return { deviceId: info.deviceId, label, virtual: isVirtualDevice(info.label) };
}

export interface Capabilities {
  canChooseOutput: boolean;
  canCaptureDisplayAudio: boolean;
}

export function detectCapabilities(): Capabilities {
  const hasAudioContext = typeof AudioContext !== 'undefined';
  const contextSink = hasAudioContext && 'setSinkId' in AudioContext.prototype;
  const elementSink = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  // Only Chromium-based desktop browsers deliver audio from getDisplayMedia.
  const chromium = 'chrome' in globalThis || /\b(Chrome|Chromium|Edg)\//.test(navigator.userAgent);
  const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  return {
    canChooseOutput: contextSink || elementSink,
    canCaptureDisplayAudio:
      typeof navigator.mediaDevices?.getDisplayMedia === 'function' && chromium && !mobile,
  };
}

export async function listDevices(): Promise<DeviceState> {
  const capabilities = detectCapabilities();
  if (!navigator.mediaDevices?.enumerateDevices) {
    return { inputs: [], outputs: [], labelsAvailable: false, ...capabilities };
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  const real = all.filter((info) => info.deviceId && !PSEUDO_DEVICE_IDS.has(info.deviceId));
  const inputs = real
    .filter((info) => info.kind === 'audioinput')
    .map((info, i) => toAudioDevice(info, i, 'Microphone'));
  const outputs = real
    .filter((info) => info.kind === 'audiooutput')
    .map((info, i) => toAudioDevice(info, i, 'Speaker'));
  return {
    inputs,
    outputs,
    // Browsers hide labels until the page has been granted microphone access.
    labelsAvailable: all.some((info) => info.label !== ''),
    ...capabilities,
  };
}

export function findDevice(devices: readonly AudioDevice[], deviceId: string): AudioDevice | undefined {
  return devices.find((device) => device.deviceId === deviceId);
}
