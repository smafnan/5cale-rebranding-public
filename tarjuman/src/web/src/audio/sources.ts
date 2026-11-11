/**
 * Opening the audio sources of the two channels and explaining failures in plain language.
 */

export type SourceKind = 'microphone' | 'display' | 'device';

export interface OpenedSource {
  kind: SourceKind;
  stream: MediaStream;
  /** Human-readable description for the UI. */
  label: string;
  /** For display capture: what was shared ("browser" tab, "window" or "monitor" = whole screen). */
  surface: 'browser' | 'window' | 'monitor' | null;
  /** True when the captured tab is muted locally, so we must replay the original ourselves. */
  suppressesLocalPlayback: boolean;
  /** True when the capture excludes the audio this page plays (no self-capture loop). */
  excludesOwnAudio: boolean;
}

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceError';
  }
}

export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function trackLabel(stream: MediaStream, fallback: string): string {
  return stream.getAudioTracks()[0]?.label || fallback;
}

/**
 * The user's own microphone. Noise suppression and gain control stay on (people sit in
 * offices, not studios). Echo cancellation is only needed when the translated voice comes
 * out of loudspeakers next to the microphone.
 */
export async function openMicrophone(deviceId: string, options: { echoCancellation: boolean }): Promise<OpenedSource> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: 1,
      echoCancellation: options.echoCancellation,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  return {
    kind: 'microphone',
    stream,
    label: trackLabel(stream, 'Microphone'),
    surface: null,
    suppressesLocalPlayback: false,
    excludesOwnAudio: true,
  };
}

/**
 * An input device used as a line-in, typically the far end of a virtual cable that the
 * meeting app plays into. All voice processing is off: the signal is already clean, and
 * echo cancellation would try to remove the very audio we want.
 */
export async function openInputDevice(deviceId: string): Promise<OpenedSource> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  return {
    kind: 'device',
    stream,
    label: trackLabel(stream, 'Audio device'),
    surface: null,
    suppressesLocalPlayback: false,
    excludesOwnAudio: true,
  };
}

/** Options that exist in Chromium but not yet in TypeScript's DOM typings. */
interface DisplayAudioConstraints extends MediaTrackConstraints {
  suppressLocalAudioPlayback?: boolean;
  restrictOwnAudio?: boolean;
}

interface DisplayOptions extends DisplayMediaStreamOptions {
  audio: DisplayAudioConstraints;
  systemAudio?: 'include' | 'exclude';
  windowAudio?: 'exclude' | 'window' | 'system';
  audioSelection?: 'preferred';
  selfBrowserSurface?: 'include' | 'exclude';
  surfaceSwitching?: 'include' | 'exclude';
  monitorTypeSurfaces?: 'include' | 'exclude';
}

interface DisplayTrackSettings extends MediaTrackSettings {
  suppressLocalAudioPlayback?: boolean;
  restrictOwnAudio?: boolean;
}

const SURFACE_LABEL = {
  browser: 'Browser tab audio',
  window: 'Window audio',
  monitor: 'System audio',
} as const;

/**
 * Audio of a browser tab, a window, or the whole system, chosen by the user in the
 * browser's sharing dialog.
 *
 * Browsers refuse audio-only sharing, so a video track comes along. It is kept alive at
 * one frame per second and never read: whether the audio survives ending the video track
 * is not guaranteed, and the cost of an idle 1 fps track is negligible.
 *
 * With `suppressLocalAudioPlayback` the captured tab is muted locally (we replay it at a
 * chosen volume instead). For a whole screen the same flag would mute the entire output
 * device, so in that mode the dialog only offers browser tabs.
 */
export async function openDisplayAudio(options: { suppressLocalAudioPlayback: boolean }): Promise<OpenedSource> {
  const tabOnly = options.suppressLocalAudioPlayback;
  const request: DisplayOptions = {
    video: { frameRate: { max: 1 }, ...(tabOnly ? { displaySurface: 'browser' } : {}) },
    audio: {
      // The other side's voice must reach the recognizer untouched (all three default to on).
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      suppressLocalAudioPlayback: tabOnly,
      // When system audio is shared, leave out what this page itself plays (our translation).
      // Honoured on Windows 11+ and macOS 14.2+; the track settings tell us whether it took effect.
      restrictOwnAudio: true,
    },
    systemAudio: tabOnly ? 'exclude' : 'include',
    windowAudio: tabOnly ? 'exclude' : 'system',
    audioSelection: 'preferred',
    monitorTypeSurfaces: tabOnly ? 'exclude' : 'include',
    // Sharing this very tab would capture our own translated speech.
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'exclude',
  };
  const stream = await navigator.mediaDevices.getDisplayMedia(request);

  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) {
    // Not an error for the browser: the user simply left the audio box unticked.
    stopStream(stream);
    throw new SourceError(
      'Nothing to listen to: the share did not include audio. Start again and tick "Also share tab audio" ' +
        '(or "Also share system audio") in the sharing dialog.',
    );
  }

  const surfaceSetting = stream.getVideoTracks()[0]?.getSettings().displaySurface;
  const surface = surfaceSetting === 'browser' || surfaceSetting === 'window' || surfaceSetting === 'monitor' ? surfaceSetting : null;
  const settings = audioTrack.getSettings() as DisplayTrackSettings;

  return {
    kind: 'display',
    stream,
    label: surface ? SURFACE_LABEL[surface] : 'Shared audio',
    surface,
    suppressesLocalPlayback: settings.suppressLocalAudioPlayback === true,
    // A tab's audio never contains this page. Window and screen shares carry system audio,
    // which does, unless the browser confirms it left our own audio out.
    excludesOwnAudio: surface === 'browser' || settings.restrictOwnAudio === true,
  };
}

/** Turn a getUserMedia / getDisplayMedia failure into something a user can act on. */
export function describeSourceError(error: unknown, kind: SourceKind): string {
  if (error instanceof SourceError) return error.message;
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  const what = kind === 'display' ? 'screen or tab sharing' : kind === 'device' ? 'the audio device' : 'the microphone';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return kind === 'display'
        ? 'Sharing was cancelled. Press the button again and choose the tab or screen that plays the call.'
        : `Access to ${what} was blocked. Allow it in the browser's address bar (site settings) and try again.`;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `The selected device for ${what} was not found. It may be unplugged; pick another one.`;
    case 'NotReadableError':
    case 'AbortError':
      return `Could not open ${what}. Another application may be using it exclusively.`;
    case 'NotSupportedError':
    case 'TypeError':
      return kind === 'display'
        ? 'This browser cannot share tab or system audio. Use Chrome or Edge on a computer.'
        : `This browser cannot open ${what}.`;
    default:
      return `Could not open ${what}: ${error instanceof Error ? error.message : String(error)}`;
  }
}
