import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import type { RawData, WebSocket } from 'ws';

import {
  bytesToPcm16,
  decodeBinaryFrame,
  PROTOCOL_VERSION,
  ProtocolError,
  type ErrorCode,
  type ServerMessage,
} from '../../shared/protocol';
import { InterpreterSession } from '../pipeline/session';
import type { Services } from '../services';
import { parseAudioHeader, parseClientMessage } from './messages';
import { checkRequestOrigin, safeEqual } from './security';

/**
 * One WebSocket connection = one interpreted call.
 *
 * This file only does transport work: authentication, framing, validation and
 * liveness. Everything about interpreting lives in `InterpreterSession`.
 */

/** 30 s of 16 kHz 16-bit mono is 960 kB; leave headroom for the frame header. */
export const WS_MAX_PAYLOAD_BYTES = 1_200_000;

const HEARTBEAT_INTERVAL_MS = 20_000;

/** Stop queueing audio for a browser that has stopped reading (suspended tab, dead link). */
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;

function toBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return data;
}

export class ConnectionHub {
  private readonly sockets = new Set<WebSocket>();

  constructor(private readonly services: Services) {
    // Tell every open call when a provider goes into or comes out of cooldown.
    services.onStatusChange(() =>
      this.broadcast({ type: 'providers.status', providers: services.providerStatus() }),
    );
  }

  get size(): number {
    return this.sockets.size;
  }

  private broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const socket of this.sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  /** Decide whether an upgrade request may open a call. Returns a rejection reason or null. */
  authorize(request: FastifyRequest): { code: ErrorCode; message: string } | null {
    const { config } = this.services;
    const originProblem = checkRequestOrigin({
      listenHost: config.host,
      hostHeader: request.headers.host,
      originHeader: request.headers.origin,
    });
    if (originProblem) return { code: 'unauthorized', message: originProblem };

    if (config.accessToken) {
      const token = (request.query as Record<string, unknown> | undefined)?.token;
      if (typeof token !== 'string' || !safeEqual(token, config.accessToken)) {
        return { code: 'unauthorized', message: 'missing or wrong access token' };
      }
    }
    return null;
  }

  handle(socket: WebSocket, request: FastifyRequest): void {
    const sessionId = randomUUID();
    const log: FastifyBaseLogger = request.log.child({ sessionId });

    const send = (message: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    const rejection = this.authorize(request);
    if (rejection) {
      log.warn({ reason: rejection.message }, 'websocket rejected');
      send({ type: 'error', ...rejection, fatal: true });
      socket.close(1008, rejection.code);
      return;
    }

    this.sockets.add(socket);
    let started = false;
    let alive = true;

    const session = new InterpreterSession({
      chains: this.services.chains,
      logger: log,
      logTranscripts: this.services.config.logTranscripts,
      transport: {
        send,
        sendBinary: (frame) => {
          if (socket.readyState !== socket.OPEN) return;
          if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
            log.warn({ buffered: socket.bufferedAmount }, 'browser is not reading; dropping audio');
            return;
          }
          socket.send(frame, { binary: true });
        },
      },
    });

    const protocolError = (message: string, fatal = false) => {
      send({ type: 'error', code: 'protocol', message, fatal });
      if (fatal) socket.close(1002, 'protocol error');
    };

    const onText = (raw: string) => {
      const parsed = parseClientMessage(raw);
      if (!parsed.ok) return protocolError(parsed.error);
      const message = parsed.value;

      if (message.type === 'ping') return send({ type: 'pong', t: message.t });

      if (message.type === 'session.start') {
        if (message.protocol !== PROTOCOL_VERSION) {
          return protocolError(
            `protocol version ${message.protocol} is not supported (server speaks ${PROTOCOL_VERSION}); reload the page`,
            true,
          );
        }
        session.updateSettings(message.settings);
        started = true;
        return send({ type: 'session.ready', sessionId, info: this.services.info() });
      }

      if (!started) return protocolError('send session.start first');

      switch (message.type) {
        case 'session.update':
          return session.updateSettings(message.settings);
        case 'session.reset':
          return session.resetContext();
        case 'utterance.text':
          return session.submitText(message.id, message.channel, message.text);
        case 'utterance.cancel':
          return session.cancel(message.id);
      }
    };

    const onBinary = (bytes: Uint8Array) => {
      if (!started) return protocolError('send session.start first');
      let frame;
      try {
        frame = decodeBinaryFrame(bytes);
      } catch (error) {
        return protocolError(error instanceof ProtocolError ? error.message : 'malformed binary frame');
      }
      const header = parseAudioHeader(frame.header);
      if (!header.ok) return protocolError(header.error);
      session.submitAudio(header.value, bytesToPcm16(frame.payload));
    };

    socket.on('message', (data, isBinary) => {
      alive = true;
      try {
        if (isBinary) onBinary(toBuffer(data));
        else onText(toBuffer(data).toString('utf8'));
      } catch (error) {
        log.error({ err: error }, 'failed to handle websocket message');
        send({ type: 'error', code: 'internal', message: 'internal error', fatal: false });
      }
    });

    socket.on('pong', () => {
      alive = true;
    });

    // Detect half-open connections (laptop lid closed, network change) and free their resources.
    const heartbeat = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      if (socket.readyState === socket.OPEN) socket.ping();
    }, HEARTBEAT_INTERVAL_MS);

    const cleanup = () => {
      clearInterval(heartbeat);
      this.sockets.delete(socket);
      session.close();
    };
    socket.on('close', () => {
      cleanup();
      log.info({}, 'call ended');
    });
    socket.on('error', (error) => {
      log.warn({ err: error }, 'websocket error');
      cleanup();
    });

    log.info({ remote: request.ip }, 'call connected');
  }
}
