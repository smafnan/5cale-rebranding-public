import { CircleCheck, CircleMinus, CircleX, ExternalLink, Plus, Settings, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import type { DiagnosticsReport, KeysResponse, KeyStatus } from '../../../../shared/api';
import { LANG_CODES, LANGUAGES, type LangCode } from '../../../../shared/languages';
import {
  MAX_GLOSSARY_ENTRIES,
  MAX_GLOSSARY_TERM_CHARS,
  MAX_MEETING_CONTEXT_CHARS,
  type GlossaryEntry,
} from '../../../../shared/settings';
import { useAppStore } from '../../state/store';
import { PAUSE_MS_MAX, PAUSE_MS_MIN } from '../../state/types';
import { controller } from '../controller';
import { errorMessage } from '../lib/format';
import { PROVIDER_KIND_LABEL } from '../lib/providers';
import { Segmented, SelectField, Slider, Spinner, Switch } from './controls';
import { Dialog } from './Dialog';

export type SettingsTab = 'keys' | 'languages' | 'audio' | 'appearance';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'keys', label: 'API keys' },
  { id: 'languages', label: 'Languages & style' },
  { id: 'audio', label: 'Audio' },
  { id: 'appearance', label: 'Appearance' },
];

// ---------------------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------------------

function KeyCard({
  status,
  writable,
  onSaved,
}: {
  status: KeyStatus;
  writable: boolean;
  onSaved: (response: KeysResponse) => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (next: string | null) => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await controller().saveKeys({ [status.name]: next }));
      setValue('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const state =
    status.source === 'env'
      ? 'Set in the environment'
      : status.source === 'file'
        ? `Saved (${status.hint ?? '••••'})`
        : 'Not set';

  return (
    <div className="card">
      <div className="card__head">
        <span className="card__title">{status.label}</span>
        {status.recommended ? <span className="badge badge--accent">Recommended</span> : null}
        <span className={`badge ${status.set ? 'badge--ok' : ''}`}>{state}</span>
        <span className="card__spacer" />
        <a href={status.signupUrl} target="_blank" rel="noopener noreferrer" className="small">
          Get a free key <ExternalLink size={12} aria-hidden="true" />
        </a>
      </div>
      <p className="muted small">{status.description}</p>
      {status.source === 'env' ? (
        <p className="field__note">This key comes from the server's environment and cannot be changed here.</p>
      ) : (
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim()) void submit(value.trim());
          }}
        >
          <div className="field">
            <input
              className="input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label={`${status.label} key`}
              placeholder={status.set ? 'Paste a new key to replace it' : 'Paste the key here'}
              value={value}
              disabled={!writable || busy}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <button type="submit" className="button button--primary" disabled={!writable || busy || !value.trim()}>
            {busy ? <Spinner /> : null} Save
          </button>
          {status.source === 'file' ? (
            <button type="button" className="button" disabled={!writable || busy} onClick={() => void submit(null)}>
              Remove
            </button>
          ) : null}
        </form>
      )}
      {error ? <p className="field__note field__note--danger">{error}</p> : null}
    </div>
  );
}

const OUTCOME = {
  ok: { icon: CircleCheck, label: 'OK' },
  failed: { icon: CircleX, label: 'Failed' },
  skipped: { icon: CircleMinus, label: 'Not set up' },
} as const;

function Diagnostics() {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setReport(await controller().runDiagnostics());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack stack--tight">
      <div className="row">
        <button type="button" className="button" disabled={busy} onClick={() => void run()}>
          {busy ? <Spinner /> : null} Test providers
        </button>
        <span className="muted small">Sends one small real request to each provider that is set up.</span>
      </div>
      {error ? <p className="field__note field__note--danger">{error}</p> : null}
      {report ? (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">Provider</th>
              <th scope="col">Result</th>
              <th scope="col">Time</th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {report.results.map((result) => {
              const Icon = OUTCOME[result.outcome].icon;
              return (
                <tr key={`${result.kind}:${result.id}`}>
                  <td>{PROVIDER_KIND_LABEL[result.kind]}</td>
                  <td>{result.label}</td>
                  <td className={`outcome--${result.outcome}`}>
                    <Icon size={14} aria-hidden="true" /> {OUTCOME[result.outcome].label}
                  </td>
                  <td>{result.outcome === 'skipped' ? '—' : `${result.ms} ms`}</td>
                  <td dir="auto">{result.detail}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function KeysTab() {
  const [keys, setKeys] = useState<KeysResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    controller()
      .getKeys()
      .then((response) => {
        if (!cancelled) setKeys(response);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="field__note field__note--danger">Could not load the keys: {error}</p>;
  if (!keys) {
    return (
      <p className="muted">
        <Spinner /> Loading…
      </p>
    );
  }

  return (
    <div className="stack">
      <p className="muted">
        Tarjuman uses free tiers of these services. Keys are stored on the computer that runs the Tarjuman server
        and are never sent to the browser again.
      </p>
      {!keys.writable ? (
        <p className="field__note field__note--warn">
          This server does not accept keys from the browser. Set them in its environment (.env file) instead.
        </p>
      ) : null}
      {keys.keys.map((status) => (
        <KeyCard key={status.name} status={status} writable={keys.writable} onSaved={setKeys} />
      ))}
      <Diagnostics />
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Languages & style
// ---------------------------------------------------------------------------------------

function GlossaryEditor() {
  const glossary = useAppStore((state) => state.settings.session.glossary);
  // Rows are edited locally so a half-typed term is not sanitised away while typing.
  const [rows, setRows] = useState<GlossaryEntry[]>(glossary);

  const commit = (next: GlossaryEntry[]) => {
    setRows(next);
    controller().updateSettings({ session: { glossary: next.filter((row) => row.term.trim()) } });
  };
  const edit = (index: number, patch: Partial<GlossaryEntry>) =>
    commit(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <div className="stack stack--tight">
      <h3 className="section-title">Glossary</h3>
      <p className="muted small">
        Names and terms that must be rendered exactly. Leave the translation empty to keep a term unchanged.
      </p>
      <div className="glossary">
        {rows.map((row, index) => (
          <div className="glossary__row" key={index}>
            <input
              className="input"
              dir="auto"
              aria-label={`Term ${index + 1}`}
              placeholder="Term, as spoken"
              maxLength={MAX_GLOSSARY_TERM_CHARS}
              value={row.term}
              onChange={(event) => edit(index, { term: event.target.value })}
            />
            <input
              className="input"
              dir="auto"
              aria-label={`Translation of term ${index + 1}`}
              placeholder="Must be rendered as (optional)"
              maxLength={MAX_GLOSSARY_TERM_CHARS}
              value={row.translation}
              onChange={(event) => edit(index, { translation: event.target.value })}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove term ${index + 1}`}
              onClick={() => commit(rows.filter((_, i) => i !== index))}
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <div>
        <button
          type="button"
          className="button button--small"
          disabled={rows.length >= MAX_GLOSSARY_ENTRIES}
          onClick={() => setRows([...rows, { term: '', translation: '' }])}
        >
          <Plus size={14} aria-hidden="true" /> Add a term
        </button>
      </div>
    </div>
  );
}

function LanguagesTab() {
  const session = useAppStore((state) => state.settings.session);
  const mine = session.channels.outgoing.sourceLang;
  const theirs = session.channels.outgoing.targetLang;
  const options = LANG_CODES.map((code) => ({ value: code, label: `${LANGUAGES[code].name} · ${LANGUAGES[code].nativeName}` }));

  /** Both channels always mirror each other: what I speak is what they hear translated, and vice versa. */
  const setPair = (nextMine: LangCode, nextTheirs: LangCode) => {
    if (nextMine === nextTheirs) return;
    controller().updateSettings({
      session: {
        channels: {
          outgoing: { sourceLang: nextMine, targetLang: nextTheirs, voice: 'auto' },
          incoming: { sourceLang: nextTheirs, targetLang: nextMine, voice: 'auto' },
        },
        // A caption in a language that is already spoken or heard would be redundant.
        captionLangs: session.captionLangs.filter((lang) => lang !== nextMine && lang !== nextTheirs),
      },
    });
  };

  const captionChoices = LANG_CODES.filter((code) => code !== mine && code !== theirs);

  return (
    <div className="stack">
      <div className="row">
        <SelectField
          label="I speak"
          value={mine}
          options={options.filter((option) => option.value !== theirs)}
          onChange={(value) => setPair(value as LangCode, theirs)}
        />
        <SelectField
          label="They speak"
          value={theirs}
          options={options.filter((option) => option.value !== mine)}
          onChange={(value) => setPair(mine, value as LangCode)}
        />
      </div>

      {captionChoices.length > 0 ? (
        <fieldset className="segmented">
          <legend className="field__label">Also show captions in</legend>
          <div className="checks">
            {captionChoices.map((code) => (
              <label key={code} className="check">
                <input
                  type="checkbox"
                  checked={session.captionLangs.includes(code)}
                  onChange={(event) =>
                    controller().updateSettings({
                      session: {
                        captionLangs: event.target.checked
                          ? [...session.captionLangs, code]
                          : session.captionLangs.filter((lang) => lang !== code),
                      },
                    })
                  }
                />
                {LANGUAGES[code].name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <Segmented
        label="Form of address"
        value={session.formality}
        options={[
          { value: 'formal', label: 'Formal — "Sie" / "آپ"' },
          { value: 'informal', label: 'Informal — "du"' },
        ]}
        onChange={(formality) => controller().updateSettings({ session: { formality } })}
      />

      <div className="field">
        <div className="field__head">
          <label className="field__label" htmlFor="meeting-context">
            Meeting context
          </label>
          <span className="field__note">
            {session.meetingContext.length} / {MAX_MEETING_CONTEXT_CHARS}
          </span>
        </div>
        <textarea
          id="meeting-context"
          className="textarea"
          dir="auto"
          maxLength={MAX_MEETING_CONTEXT_CHARS}
          placeholder="For example: weekly planning call of a software team; we discuss releases, tickets and deadlines."
          value={session.meetingContext}
          onChange={(event) => controller().updateSettings({ session: { meetingContext: event.target.value } })}
        />
        <p className="field__note">One or two sentences about the meeting help the translator pick the right terms.</p>
      </div>

      <GlossaryEditor />
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Audio and appearance
// ---------------------------------------------------------------------------------------

function AudioTab() {
  const settings = useAppStore((state) => state.settings);
  const update = controller().updateSettings.bind(controller());
  return (
    <div className="stack">
      <Switch
        checked={settings.headphones}
        onChange={(headphones) => update({ headphones })}
        label="I am using headphones"
        note="Leave this on when translated speech only reaches your ears. Without headphones, turn it off: the microphone is then paused while a translation plays, so it is not translated again."
      />
      <Segmented
        label="Speech detection sensitivity"
        value={settings.vadSensitivity}
        options={[
          { value: 'low', label: 'Low' },
          { value: 'normal', label: 'Normal' },
          { value: 'high', label: 'High' },
        ]}
        onChange={(vadSensitivity) => update({ vadSensitivity })}
      />
      <p className="field__note">Low ignores background voices in a noisy room; High also catches quiet or distant speakers.</p>
      <Slider
        label="Pause that ends a sentence"
        value={settings.pauseMs}
        min={PAUSE_MS_MIN}
        max={PAUSE_MS_MAX}
        step={50}
        format={(value) => `${value} ms`}
        onChange={(pauseMs) => update({ pauseMs })}
        note="Shorter is faster but cuts sentences in the middle more often; longer waits for complete sentences."
      />
      <Switch
        checked={settings.browserTtsFallback}
        onChange={(browserTtsFallback) => update({ browserTtsFallback })}
        label="Use the browser's voice if the server voice fails"
        note="The browser's voice always plays on the default speakers, so it only helps for what you hear."
      />
    </div>
  );
}

function AppearanceTab() {
  const ui = useAppStore((state) => state.settings.ui);
  const update = controller().updateSettings.bind(controller());
  return (
    <div className="stack">
      <Segmented
        label="Theme"
        value={ui.theme}
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
        onChange={(theme) => update({ ui: { theme } })}
      />
      <Segmented
        label="Urdu typeface"
        value={ui.urduFont}
        options={[
          {
            value: 'nastaliq',
            label: (
              <>
                Nastaliq ·{' '}
                <span className="font-preview font-preview--nastaliq" lang="ur" dir="rtl">
                  اردو
                </span>
              </>
            ),
          },
          {
            value: 'naskh',
            label: (
              <>
                Naskh ·{' '}
                <span className="font-preview font-preview--naskh" lang="ur" dir="rtl">
                  اردو
                </span>
              </>
            ),
          },
        ]}
        onChange={(urduFont) => update({ ui: { urduFont } })}
      />
      <Slider
        label="Caption size"
        value={ui.captionScale}
        min={0.85}
        max={1.6}
        step={0.05}
        format={(value) => `${Math.round(value * 100)}%`}
        onChange={(captionScale) => update({ ui: { captionScale } })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------

interface SettingsDialogProps {
  open: boolean;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  onClose: () => void;
  overlay?: ReactNode;
}

export function SettingsDialog({ open, tab, onTabChange, onClose, overlay }: SettingsDialogProps) {
  const version = useAppStore((state) => state.server?.version);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Settings"
      icon={<Settings size={18} aria-hidden="true" />}
      overlay={overlay}
      footer={
        <>
          <span>{version ? `Tarjuman ${version}` : 'Tarjuman'}</span>
          <span>Settings are saved in this browser.</span>
        </>
      }
    >
      <div className="tabs" role="tablist" aria-label="Settings sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="tab"
            id={`settings-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls="settings-panel"
            onClick={() => onTabChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${tab}`}>
        {tab === 'keys' ? <KeysTab /> : null}
        {tab === 'languages' ? <LanguagesTab /> : null}
        {tab === 'audio' ? <AudioTab /> : null}
        {tab === 'appearance' ? <AppearanceTab /> : null}
      </div>
    </Dialog>
  );
}
