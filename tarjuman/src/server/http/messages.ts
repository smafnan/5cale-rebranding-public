import { z } from 'zod';

import { LIMITS, UTTERANCE_SAMPLE_RATE, type AudioUtteranceHeader, type ClientMessage } from '../../shared/protocol';
import { CHANNEL_IDS, sanitizeSessionSettings } from '../../shared/settings';

/**
 * Validation of everything a browser can send over the WebSocket. Nothing reaches the
 * pipeline without passing through here.
 */

const utteranceId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const channel = z.enum(CHANNEL_IDS);

/** Settings are sanitized rather than rejected: a slightly-off client still gets a working call. */
const settings = z.unknown().transform((value) => sanitizeSessionSettings(value));

const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session.start'), protocol: z.number().int(), settings }),
  z.object({ type: z.literal('session.update'), settings }),
  z.object({ type: z.literal('session.reset') }),
  z.object({
    type: z.literal('utterance.text'),
    id: utteranceId,
    channel,
    text: z.string().min(1).max(LIMITS.maxTextChars * 2),
  }),
  z.object({ type: z.literal('utterance.cancel'), id: utteranceId }),
  z.object({ type: z.literal('ping'), t: z.number() }),
]);

const audioHeaderSchema = z.object({
  type: z.literal('utterance.audio'),
  id: utteranceId,
  channel,
  sampleRate: z.literal(UTTERANCE_SAMPLE_RATE),
  durationMs: z.number().nonnegative(),
  endedAt: z.number().nonnegative(),
  forcedSplit: z.boolean(),
  playbackLagMs: z.number().nonnegative().max(600_000),
});

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function describe(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.') || 'message'}: ${issue.message}` : 'invalid message';
}

export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'message is not valid JSON' };
  }
  const parsed = clientMessageSchema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: describe(parsed.error) };
}

export function parseAudioHeader(header: unknown): ParseResult<AudioUtteranceHeader> {
  const parsed = audioHeaderSchema.safeParse(header);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: describe(parsed.error) };
}
