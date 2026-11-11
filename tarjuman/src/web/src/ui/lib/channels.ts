import type { ChannelId, ChannelSettings } from '../../../../shared/settings';
import type { DeepPartial, LocalSettings } from '../../state/types';

export interface ChannelCopy {
  /** Short label that identifies the channel wherever its colour is used. */
  tag: string;
  title: string;
  start: string;
  stop: string;
  idle: string;
}

export const CHANNEL_COPY: Record<ChannelId, ChannelCopy> = {
  outgoing: {
    tag: 'You',
    title: 'You speak',
    start: 'Start microphone',
    stop: 'Stop microphone',
    idle: 'Microphone is off',
  },
  incoming: {
    tag: 'Them',
    title: 'They speak',
    start: 'Capture their audio',
    stop: 'Stop capturing',
    idle: 'Not capturing',
  },
};

/** Settings patch for one channel of the session (voice, speech rate, ...). */
export function sessionChannelPatch(
  channel: ChannelId,
  patch: Partial<ChannelSettings>,
): DeepPartial<LocalSettings> {
  return { session: { channels: channel === 'outgoing' ? { outgoing: patch } : { incoming: patch } } };
}
