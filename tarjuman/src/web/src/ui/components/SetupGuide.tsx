import { BookOpen, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useAppStore } from '../../state/store';
import { controller } from '../controller';
import { cx } from '../lib/cx';
import { deviceOptions } from '../lib/devices';
import { SelectField } from './controls';
import { Dialog } from './Dialog';

function Step({ title, done, children }: { title: string; done?: boolean; children: ReactNode }) {
  return (
    <li className={cx('step', done && 'is-done')}>
      <div className="step__body">
        <h3 className="step__title">
          {title} {done ? <span className="badge badge--ok">done</span> : null}
        </h3>
        {children}
      </div>
    </li>
  );
}

/** Step-by-step wiring of Tarjuman into a Microsoft Teams call, with live checks. */
export function SetupGuide({ open, onClose, overlay }: { open: boolean; onClose: () => void; overlay?: ReactNode }) {
  const devices = useAppStore((state) => state.devices);
  const sinkId = useAppStore((state) => state.settings.outgoing.sinkId);
  const captures = useAppStore(
    useShallow((state) => ({ outgoing: state.channels.outgoing.capture, incoming: state.channels.incoming.capture })),
  );

  const virtualOutputs = devices.outputs.filter((device) => device.virtual);
  const firstVirtual = virtualOutputs[0];
  const sinkIsVirtual = virtualOutputs.some((device) => device.deviceId === sinkId);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Use Tarjuman in a Teams call"
      icon={<BookOpen size={18} aria-hidden="true" />}
      overlay={overlay}
    >
      <ol className="steps">
        <Step title="Install a virtual audio cable" done={virtualOutputs.length > 0}>
          <p className="muted">
            A virtual cable is a pretend sound device: what Tarjuman plays into it, Teams hears as a microphone.
          </p>
          <ul>
            <li>
              <strong>Windows:</strong> VB-CABLE from vb-audio.com/Cable. Restart the computer afterwards.
            </li>
            <li>
              <strong>macOS:</strong> BlackHole 2ch (<span className="kbd">brew install blackhole-2ch</span>).
            </li>
            <li>
              <strong>Linux:</strong> a PipeWire or PulseAudio null sink with a remap source (see the documentation).
            </li>
          </ul>
          <div className="step__actions">
            <span className={virtualOutputs.length > 0 ? 'outcome--ok' : 'muted'}>
              {!devices.labelsAvailable
                ? 'Device names are hidden until microphone access is allowed.'
                : virtualOutputs.length > 0
                  ? `Found: ${virtualOutputs.map((device) => device.label).join(', ')}`
                  : 'No virtual cable found yet.'}
            </span>
            {!devices.labelsAvailable ? (
              <button type="button" className="button button--small" onClick={() => void controller().unlockDeviceLabels()}>
                Show device names
              </button>
            ) : (
              <button type="button" className="button button--small" onClick={() => void controller().refreshDevices()}>
                <RefreshCw size={13} aria-hidden="true" /> Refresh devices
              </button>
            )}
          </div>
        </Step>

        <Step title="Send your translated voice into Teams" done={sinkIsVirtual}>
          <SelectField
            label="Translated voice goes to"
            value={sinkId}
            options={deviceOptions(devices.outputs, sinkId, 'Speaker')}
            onChange={(next) => controller().updateSettings({ outgoing: { sinkId: next } })}
            disabled={!devices.canChooseOutput}
          />
          {firstVirtual && !sinkIsVirtual ? (
            <div className="step__actions">
              <button
                type="button"
                className="button button--small button--primary"
                onClick={() => controller().updateSettings({ outgoing: { sinkId: firstVirtual.deviceId } })}
              >
                Use {firstVirtual.label}
              </button>
            </div>
          ) : null}
          <p className="muted">In Teams, open Settings → Devices and set:</p>
          <ul>
            <li>
              <strong>Microphone:</strong> the other end of the cable — "CABLE Output" on Windows, "BlackHole 2ch" on
              macOS.
            </li>
            <li>
              <strong>Noise suppression:</strong> Low or Off, and turn Voice isolation off. Otherwise Teams may cut
              the synthetic voice.
            </li>
          </ul>
          <div className="step__actions">
            {/* Direct call in the click handler: audio may only start from a user action. */}
            <button type="button" className="button button--small" onClick={() => void controller().playTestPhrase('outgoing')}>
              Play a test phrase
            </button>
            <span className="muted small">Watch the microphone level in Teams move ("Make a test call").</span>
          </div>
        </Step>

        <Step title="Hear the other side in your language" done={captures.incoming === 'capturing'}>
          <p className="muted">Wear headphones, so the translated voice is not picked up by your microphone.</p>
          <ul>
            <li>
              <strong>Teams in a browser tab (simplest):</strong> press "Capture their audio", choose the Teams tab
              and tick "Also share tab audio".
            </li>
            <li>
              <strong>Teams desktop app on Windows:</strong> choose "Entire screen" and tick "Also share system
              audio".
            </li>
            <li>
              <strong>Any system, most reliable:</strong> set the Teams speaker to a second virtual cable and select
              it under "Audio device" in the "They speak" panel.
            </li>
          </ul>
          <div className="step__actions">
            <button type="button" className="button button--small" onClick={() => void controller().playTestPhrase('incoming')}>
              Play a test phrase
            </button>
            <span className="muted small">You should hear it in your headphones.</span>
          </div>
        </Step>

        <Step
          title="Start interpreting"
          done={captures.outgoing === 'capturing' && captures.incoming === 'capturing'}
        >
          <p className="muted">
            Speak in complete sentences and pause briefly between them: each sentence is translated when you pause.
          </p>
          <div className="step__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={captures.outgoing === 'capturing' || captures.outgoing === 'starting'}
              onClick={() => void controller().startChannel('outgoing')}
            >
              Start microphone
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={captures.incoming === 'capturing' || captures.incoming === 'starting'}
              onClick={() => void controller().startChannel('incoming')}
            >
              Capture their audio
            </button>
          </div>
        </Step>
      </ol>
    </Dialog>
  );
}
