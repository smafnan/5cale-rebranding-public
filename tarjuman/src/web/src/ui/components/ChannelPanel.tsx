import { Mic, MonitorSpeaker, Square, Volume2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { LANGUAGES } from '../../../../shared/languages';
import { SPEECH_RATE_MAX, SPEECH_RATE_MIN, type ChannelId } from '../../../../shared/settings';
import { useAppStore } from '../../state/store';
import { controller } from '../controller';
import { CHANNEL_COPY, sessionChannelPatch } from '../lib/channels';
import { cx } from '../lib/cx';
import { deviceOptions } from '../lib/devices';
import { formatPercent, formatRate, formatSeconds } from '../lib/format';
import { SelectField, Segmented, Slider, Spinner, Switch } from './controls';

/**
 * More queued speech than one ordinary sentence means the interpreter has fallen behind;
 * only then is the queue (and the way to skip it) worth showing.
 */
const BACKLOG_NOTICE_MS = 6_000;

/** Subscribed to the level alone, so ten updates a second repaint only this bar. */
function LevelMeter({ channel }: { channel: ChannelId }) {
  const level = useAppStore((state) => state.channels[channel].level);
  const gated = useAppStore((state) => state.channels[channel].gated);
  return (
    <div className={cx('meter', gated && 'meter--gated')} role="presentation">
      <div className="meter__fill" style={{ transform: `scaleX(${level.toFixed(3)})` }} />
    </div>
  );
}

function CaptureStatus({ channel }: { channel: ChannelId }) {
  const runtime = useAppStore(
    useShallow((state) => {
      const c = state.channels[channel];
      return {
        capture: c.capture,
        captureError: c.captureError,
        sourceLabel: c.sourceLabel,
        speaking: c.speaking,
        gated: c.gated,
        pttHeld: c.pttHeld,
      };
    }),
  );
  const pushToTalk = useAppStore(
    (state) => channel === 'outgoing' && state.settings.outgoing.micMode === 'push-to-talk',
  );

  if (runtime.captureError) return <p className="status status--error">{runtime.captureError}</p>;
  if (runtime.capture === 'starting') return <p className="status">Starting…</p>;
  if (runtime.capture !== 'capturing') return <p className="status">{CHANNEL_COPY[channel].idle}</p>;
  if (pushToTalk) {
    return runtime.pttHeld ? (
      <p className="status status--live">Listening…</p>
    ) : (
      <p className="status">Hold Space to talk</p>
    );
  }
  if (runtime.gated) return <p className="status">Paused while the translation plays</p>;
  if (runtime.speaking) return <p className="status status--live">Speaking…</p>;
  return <p className="status">{runtime.sourceLabel ?? 'Listening'}</p>;
}

function Activity({ channel }: { channel: ChannelId }) {
  const { pending, queueMs, playing } = useAppStore(
    useShallow((state) => {
      const c = state.channels[channel];
      // Whole 100 ms steps: the queue length is informative, not a stopwatch.
      return { pending: c.pending, queueMs: Math.round(c.queueMs / 100) * 100, playing: c.playing };
    }),
  );
  return (
    <div className="activity">
      {pending > 0 ? (
        <span className="activity__item">
          <Spinner size={14} /> Translating {pending}
        </span>
      ) : null}
      {playing ? (
        <span className="activity__item">
          <Volume2 size={14} aria-hidden="true" /> Speaking the translation
        </span>
      ) : null}
      {queueMs > BACKLOG_NOTICE_MS ? (
        <span className="activity__item">
          {formatSeconds(queueMs)} of speech queued
          <button
            type="button"
            className="button button--small"
            onClick={() => controller().flushPlayback(channel)}
          >
            Skip
          </button>
        </span>
      ) : null}
    </div>
  );
}

function HoldToTalk() {
  const held = useAppStore((state) => state.channels.outgoing.pttHeld);
  const press = (down: boolean) => () => controller().setPushToTalk(down);
  return (
    <button
      type="button"
      className={cx('ptt', held && 'is-held')}
      aria-pressed={held}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        controller().setPushToTalk(true);
      }}
      onPointerUp={press(false)}
      onPointerCancel={press(false)}
      onLostPointerCapture={press(false)}
    >
      {held ? 'Listening — release to translate' : 'Hold to talk (or hold Space)'}
    </button>
  );
}

function VoiceControls({ channel }: { channel: ChannelId }) {
  const settings = useAppStore((state) => state.settings.session.channels[channel]);
  const voices = useAppStore((state) => state.server?.voices);
  const options = [
    { value: 'auto', label: 'Default voice' },
    ...(voices ?? [])
      .filter((voice) => voice.lang === settings.targetLang)
      .map((voice) => ({ value: voice.id, label: `${voice.label} · ${voice.gender}` })),
  ];
  // A voice saved earlier may not exist on this server; show it as the default instead of a blank select.
  const value = options.some((option) => option.value === settings.voice) ? settings.voice : 'auto';

  return (
    <>
      <SelectField
        label={`${LANGUAGES[settings.targetLang].name} voice`}
        value={value}
        options={options}
        onChange={(voice) => controller().updateSettings(sessionChannelPatch(channel, { voice }))}
        disabled={!settings.speak}
      />
      <Switch
        checked={settings.speak}
        onChange={(speak) => controller().updateSettings(sessionChannelPatch(channel, { speak }))}
        label="Speak the translation"
        note={settings.speak ? undefined : 'Captions only.'}
      />
    </>
  );
}

function RateAndVolume({ channel }: { channel: ChannelId }) {
  const rate = useAppStore((state) => state.settings.session.channels[channel].speechRate);
  const volume = useAppStore((state) => state.settings[channel].volume);
  return (
    <>
      <Slider
        label="Speaking rate"
        value={rate}
        min={SPEECH_RATE_MIN}
        max={SPEECH_RATE_MAX}
        step={0.05}
        format={formatRate}
        onChange={(speechRate) => controller().updateSettings(sessionChannelPatch(channel, { speechRate }))}
        note="Speeds up by itself when translated speech is piling up."
      />
      <Slider
        label="Voice volume"
        value={volume}
        min={0}
        max={1.5}
        step={0.05}
        format={formatPercent}
        onChange={(value) =>
          controller().updateSettings(
            channel === 'outgoing' ? { outgoing: { volume: value } } : { incoming: { volume: value } },
          )
        }
      />
    </>
  );
}

function OutgoingControls() {
  const local = useAppStore((state) => state.settings.outgoing);
  const devices = useAppStore((state) => state.devices);
  const sinkOk = useAppStore((state) => state.channels.outgoing.sinkOk);
  const chosenSink = devices.outputs.find((device) => device.deviceId === local.sinkId);
  const update = controller().updateSettings.bind(controller());

  return (
    <div className="controls">
      <SelectField
        label="Microphone"
        value={local.micDeviceId}
        options={deviceOptions(devices.inputs, local.micDeviceId, 'Microphone')}
        onChange={(micDeviceId) => update({ outgoing: { micDeviceId } })}
      />
      <SelectField
        label="Translated voice goes to"
        value={local.sinkId}
        options={deviceOptions(devices.outputs, local.sinkId, 'Speaker')}
        onChange={(sinkId) => update({ outgoing: { sinkId } })}
        disabled={!devices.canChooseOutput}
        badge={chosenSink?.virtual ? <span className="badge badge--ok">virtual cable</span> : undefined}
        note={
          !sinkOk ? (
            <span className="field__note--danger">
              Could not use this output; playing on the default device.
            </span>
          ) : chosenSink?.virtual ? undefined : (
            <span className="field__note--warn">
              The other side only hears the translation if this is a virtual cable that Teams uses as its
              microphone.
            </span>
          )
        }
      />
      <VoiceControls channel="outgoing" />

      <details className="advanced">
        <summary>Advanced</summary>
        <div className="advanced__body">
          <Segmented
            label="Microphone mode"
            value={local.micMode}
            options={[
              { value: 'auto', label: 'Automatic' },
              { value: 'push-to-talk', label: 'Push-to-talk' },
            ]}
            onChange={(micMode) => update({ outgoing: { micMode } })}
          />
          <Slider
            label="Let them hear my own voice underneath"
            value={local.passthroughGain}
            min={0}
            max={1}
            step={0.05}
            format={formatPercent}
            onChange={(passthroughGain) => update({ outgoing: { passthroughGain } })}
            note="Only applies when the output is a virtual cable."
          />
          <Slider
            label="Hear my translation in my headphones"
            value={local.monitorGain}
            min={0}
            max={1}
            step={0.05}
            format={formatPercent}
            onChange={(monitorGain) => update({ outgoing: { monitorGain } })}
          />
          <RateAndVolume channel="outgoing" />
        </div>
      </details>
    </div>
  );
}

function IncomingControls() {
  const local = useAppStore((state) => state.settings.incoming);
  const devices = useAppStore((state) => state.devices);
  const { sinkOk, replaysOriginal, capturing } = useAppStore(
    useShallow((state) => ({
      sinkOk: state.channels.incoming.sinkOk,
      replaysOriginal: state.channels.incoming.replaysOriginal,
      capturing: state.channels.incoming.capture === 'capturing',
    })),
  );
  const update = controller().updateSettings.bind(controller());

  return (
    <div className="controls">
      <Segmented
        label="Listen to"
        value={local.sourceKind}
        options={[
          { value: 'display', label: 'Browser tab or screen' },
          { value: 'device', label: 'Audio device' },
        ]}
        onChange={(sourceKind) => update({ incoming: { sourceKind } })}
        disabled={capturing}
      />
      {local.sourceKind === 'device' ? (
        <SelectField
          label="Device that carries the call audio"
          value={local.deviceId}
          options={deviceOptions(devices.inputs, local.deviceId, 'Input')}
          onChange={(deviceId) => update({ incoming: { deviceId } })}
          note="Usually a second virtual cable that Teams uses as its speaker."
        />
      ) : !devices.canCaptureDisplayAudio && devices.inputs.length > 0 ? (
        <p className="field__note field__note--warn">
          This browser cannot share tab or system audio. Use Chrome or Edge, or choose "Audio device".
        </p>
      ) : null}
      <SelectField
        label="Translated voice plays on"
        value={local.sinkId}
        options={deviceOptions(devices.outputs, local.sinkId, 'Speaker')}
        onChange={(sinkId) => update({ incoming: { sinkId } })}
        disabled={!devices.canChooseOutput}
        note={
          sinkOk ? undefined : (
            <span className="field__note--danger">
              Could not use this output; playing on the default device.
            </span>
          )
        }
      />
      <VoiceControls channel="incoming" />

      <details className="advanced">
        <summary>Advanced</summary>
        <div className="advanced__body">
          <Slider
            label="Original voice volume"
            value={local.originalGain}
            min={0}
            max={1}
            step={0.05}
            format={formatPercent}
            onChange={(originalGain) => update({ incoming: { originalGain } })}
            disabled={capturing && !replaysOriginal}
            note="Applies when Tarjuman replays the original: a muted tab, or a virtual cable."
          />
          <Switch
            checked={local.duckOriginal}
            onChange={(duckOriginal) => update({ incoming: { duckOriginal } })}
            label="Lower the original while the translation plays"
          />
          <Switch
            checked={local.suppressLocalTabAudio}
            onChange={(suppressLocalTabAudio) => update({ incoming: { suppressLocalTabAudio } })}
            label="Mute the captured tab itself"
            note="You then hear the original only through Tarjuman, at the volume above. Browser tabs only; takes effect the next time capture starts."
          />
          <RateAndVolume channel="incoming" />
        </div>
      </details>
    </div>
  );
}

export function ChannelPanel({ channel }: { channel: ChannelId }) {
  const copy = CHANNEL_COPY[channel];
  const flow = useAppStore(
    useShallow((state) => {
      const c = state.settings.session.channels[channel];
      return { source: c.sourceLang, target: c.targetLang };
    }),
  );
  const capture = useAppStore((state) => state.channels[channel].capture);
  const pushToTalk = useAppStore(
    (state) => channel === 'outgoing' && state.settings.outgoing.micMode === 'push-to-talk',
  );
  const labelsAvailable = useAppStore((state) => state.devices.labelsAvailable);
  const live = capture === 'capturing';
  const Icon = channel === 'outgoing' ? Mic : MonitorSpeaker;

  return (
    <section className={`panel panel--${channel}`} aria-label={copy.title}>
      <div className="panel__head">
        <div>
          <h2 className="panel__title">{copy.title}</h2>
          <p className="panel__flow">
            {LANGUAGES[flow.source].name} → {LANGUAGES[flow.target].name}
          </p>
        </div>
        <span className={`tag tag--${channel}`}>{copy.tag}</span>
      </div>

      <div className="capture">
        <button
          type="button"
          className={cx('button capture__button', live ? 'is-live' : 'button--primary')}
          disabled={capture === 'starting'}
          // Called directly in the click handler: browsers only open the microphone, the
          // sharing dialog and audio playback in response to a user action.
          onClick={() => (live ? controller().stopChannel(channel) : void controller().startChannel(channel))}
        >
          {capture === 'starting' ? (
            <Spinner />
          ) : live ? (
            <Square size={15} aria-hidden="true" />
          ) : (
            <Icon size={16} aria-hidden="true" />
          )}
          {live ? copy.stop : copy.start}
        </button>
        <CaptureStatus channel={channel} />
        <LevelMeter channel={channel} />
      </div>

      {pushToTalk && live ? <HoldToTalk /> : null}
      <Activity channel={channel} />

      {channel === 'outgoing' ? <OutgoingControls /> : <IncomingControls />}

      {!labelsAvailable ? (
        <button
          type="button"
          className="button button--small"
          onClick={() => void controller().unlockDeviceLabels()}
        >
          Show device names
        </button>
      ) : null}
    </section>
  );
}
