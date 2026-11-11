import { SendHorizontal } from 'lucide-react';
import { useState } from 'react';

import { LANGUAGES } from '../../../../shared/languages';
import type { ChannelId } from '../../../../shared/settings';
import { useAppStore } from '../../state/store';
import { controller } from '../controller';
import { Segmented } from './controls';

/** Type instead of speaking: handy without a microphone, for names, or to test a channel. */
export function Composer() {
  const [channel, setChannel] = useState<ChannelId>('outgoing');
  const [text, setText] = useState('');
  const connected = useAppStore((state) => state.connection === 'connected');
  const sourceLang = useAppStore((state) => state.settings.session.channels[channel].sourceLang);

  const send = () => {
    if (!text.trim() || !connected) return;
    controller().sendText(channel, text);
    setText('');
  };

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <Segmented
        label="Who says this"
        hideLabel
        value={channel}
        options={[
          { value: 'outgoing', label: 'I say' },
          { value: 'incoming', label: 'They say' },
        ]}
        onChange={setChannel}
      />
      <textarea
        className="textarea"
        rows={1}
        dir="auto"
        value={text}
        disabled={!connected}
        aria-label={`Type in ${LANGUAGES[sourceLang].name}`}
        placeholder={
          connected ? `Type in ${LANGUAGES[sourceLang].name} instead of speaking…` : 'Not connected'
        }
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
          }
        }}
      />
      <button type="submit" className="button button--primary" disabled={!connected || !text.trim()}>
        <SendHorizontal size={16} aria-hidden="true" />
        Translate
      </button>
    </form>
  );
}
