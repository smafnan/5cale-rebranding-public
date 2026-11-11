import {
  decodeBinaryFrame,
  encodeBinaryFrame,
  pcm16ToBytes,
  PROTOCOL_VERSION,
  WS_PATH,
  type AudioUtteranceHeader,
  type ClientMessage,
  type ServerMessage,
  type SpeechChunkHeader,
} from '../../../shared/protocol';
import type { SessionSettings } from '../../../shared/settings';
import type { ConnectionState } from '../state/types';
import { getAccessToken } from './api';

/**
 * The WebSocket to the Tarjuman server: connects, keeps the session alive, and
 * reconnects with backoff. A connection only counts as "connected" once the server
 * has acknowledged the session, so nothing is sent into a half-open socket.
 */

export interface ConnectionHandlers {
  onState(state: ConnectionState): void;
  onMessage(message: ServerMessage): void;
  onSpeech(header: SpeechChunkHeader, audio: Uint8Array): void;
  /** Settings to open the session with (also used after every reconnect). */
  getSettings(): SessionSettings;
}

const PING_INTERVAL_MS = 15_000;
const BACKOFF_START_MS = 500;
const BACKOFF_MAX_MS = 8_000;

function socketUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const token = getAccessToken();
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${scheme}://${location.host}${WS_PATH}${query}`;
}

function isSpeechHeader(header: unknown): header is SpeechChunkHeader {
  const h = header as Partial<SpeechChunkHeader> | null;
  return (
    typeof h === 'object' &&
    h !== null &&
    h.type === 'utterance.speech' &&
    typeof h.id === 'string' &&
    (h.channel === 'outgoing' || h.channel === 'incoming') &&
    typeof h.index === 'number'
  );
}

export class ServerConnection {
  private socket: WebSocket | null = null;
  private ready = false;
  private closedByUs = false;
  /** Set when the server rejected us for a reason that retrying cannot fix. */
  private fatal = false;
  private everConnected = false;
  private backoffMs = BACKOFF_START_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly handlers: ConnectionHandlers) {}

  get connected(): boolean {
    return this.ready && this.socket?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.closedByUs = false;
    this.fatal = false;
    this.open();
  }

  private open(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.handlers.onState(this.everConnected ? 'reconnecting' : 'connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(socketUrl());
    } catch {
      this.scheduleRetry();
      return;
    }
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onopen = () => {
      const start: ClientMessage = {
        type: 'session.start',
        protocol: PROTOCOL_VERSION,
        settings: this.handlers.getSettings(),
      };
      socket.send(JSON.stringify(start));
    };

    socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
      if (socket !== this.socket) return;
      if (typeof event.data === 'string') {
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }
        if (message.type === 'session.ready') {
          this.ready = true;
          this.everConnected = true;
          this.backoffMs = BACKOFF_START_MS;
          this.startPing();
          this.handlers.onState('connected');
        } else if (message.type === 'error' && message.fatal) {
          // Wrong token or incompatible protocol: reconnecting would loop forever.
          this.fatal = true;
        }
        this.handlers.onMessage(message);
        return;
      }
      try {
        const frame = decodeBinaryFrame(new Uint8Array(event.data));
        if (isSpeechHeader(frame.header)) this.handlers.onSpeech(frame.header, frame.payload);
      } catch {
        // A frame we cannot parse is ignored; the utterance simply stays without audio.
      }
    };

    socket.onclose = () => {
      if (socket !== this.socket) return;
      this.teardown();
      if (this.closedByUs || this.fatal) {
        this.handlers.onState('disconnected');
        return;
      }
      this.scheduleRetry();
    };

    // An error is always followed by a close event, which does the handling.
    socket.onerror = () => undefined;
  }

  private teardown(): void {
    this.ready = false;
    this.socket = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private scheduleRetry(): void {
    this.handlers.onState(this.everConnected ? 'reconnecting' : 'connecting');
    const delay = this.backoffMs;
    this.backoffMs = Math.min(BACKOFF_MAX_MS, this.backoffMs * 2);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private startPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      this.sendJson({ type: 'ping', t: Date.now() });
    }, PING_INTERVAL_MS);
  }

  /** @returns false when there is no ready connection (the message is not queued). */
  sendJson(message: ClientMessage): boolean {
    if (!this.connected || !this.socket) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  /** @returns false when there is no ready connection (the audio is not queued). */
  sendAudio(header: AudioUtteranceHeader, pcm: Int16Array): boolean {
    if (!this.connected || !this.socket) return false;
    // encodeBinaryFrame returns a freshly allocated, exactly sized array, so its buffer is the frame.
    this.socket.send(encodeBinaryFrame(header, pcm16ToBytes(pcm)).buffer as ArrayBuffer);
    return true;
  }

  close(): void {
    this.closedByUs = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.teardown();
    socket?.close();
    this.handlers.onState('disconnected');
  }
}
