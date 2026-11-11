import { ArrowLeftRight, BookOpen, Settings } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { LANGUAGES } from '../../../../shared/languages';
import type { ProviderKind } from '../../../../shared/protocol';
import { useAppStore } from '../../state/store';
import type { ConnectionState } from '../../state/types';
import { controller } from '../controller';
import { useDismissable } from '../hooks/useDismissable';
import { useNow } from '../hooks/useNow';
import { formatCountdown } from '../lib/format';
import { inFallbackOrder, PROVIDER_KIND_LABEL, PROVIDER_STATE_LABEL, summarizeChain } from '../lib/providers';

const CONNECTION: Record<ConnectionState, { label: string; dot: string }> = {
  connected: { label: 'Connected', dot: 'dot--ok' },
  connecting: { label: 'Connecting…', dot: 'dot--warn' },
  reconnecting: { label: 'Reconnecting…', dot: 'dot--warn' },
  disconnected: { label: 'Disconnected', dot: 'dot--danger' },
};

const TONE_DOT = { ok: 'dot--ok', warn: 'dot--warn', danger: 'dot--danger', unknown: '' } as const;

function ProviderChip({ kind }: { kind: ProviderKind }) {
  const chain = useAppStore((state) => state.providers[kind]);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, wrap, close);

  const summary = summarizeChain(chain);
  const coolingDown = summary.tone === 'warn' && summary.cooldownUntil !== null;
  const now = useNow(coolingDown || open);

  let value = '…';
  if (summary.active) value = summary.active.label;
  else if (summary.tone === 'warn') {
    value = summary.cooldownUntil ? `Cooling down · ${formatCountdown(summary.cooldownUntil - now)}` : 'Cooling down';
  } else if (summary.tone === 'danger') value = 'Needs a key';

  return (
    <div className="chip-wrap" ref={wrap}>
      <button type="button" className="chip" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={`dot ${TONE_DOT[summary.tone]}`} aria-hidden="true" />
        <span className="chip__kind">{PROVIDER_KIND_LABEL[kind]}</span>
        <span className="chip__value">{value}</span>
      </button>
      {open ? (
        <div className="popover" role="dialog" aria-label={`${PROVIDER_KIND_LABEL[kind]} providers`}>
          <p className="popover__title">Tried in this order</p>
          <ol className="chain">
            {inFallbackOrder(chain).map((provider) => (
              <li key={provider.id} className="chain__item">
                <span
                  className={`dot ${provider.state === 'ready' ? 'dot--ok' : provider.state === 'cooldown' ? 'dot--warn' : ''}`}
                  aria-hidden="true"
                />
                <span>{provider.label}</span>
                <span className="muted small">
                  {provider.state === 'cooldown' && provider.cooldownUntil
                    ? `${PROVIDER_STATE_LABEL.cooldown} · ${formatCountdown(provider.cooldownUntil - now)}`
                    : PROVIDER_STATE_LABEL[provider.state]}
                </span>
                {provider.detail && provider.state !== 'unconfigured' ? (
                  <span className="chain__detail">{provider.detail}</span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

interface HeaderProps {
  onOpenGuide: () => void;
  onOpenSettings: () => void;
}

export function Header({ onOpenGuide, onOpenSettings }: HeaderProps) {
  const connection = useAppStore((state) => state.connection);
  const pair = useAppStore(
    useShallow((state) => ({
      mine: state.settings.session.channels.outgoing.sourceLang,
      theirs: state.settings.session.channels.outgoing.targetLang,
    })),
  );

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__name">Tarjuman</span>
        <span className="brand__ur script-arab" lang="ur" dir="rtl">
          ترجمان
        </span>
      </div>

      <span className="connection" role="status">
        <span className={`dot ${CONNECTION[connection].dot}`} aria-hidden="true" />
        {CONNECTION[connection].label}
      </span>

      <div className="pair">
        <span>
          {LANGUAGES[pair.mine].name} ⇄ {LANGUAGES[pair.theirs].name}
        </span>
        <button
          type="button"
          className="icon-button"
          title="Swap who speaks which language"
          aria-label="Swap who speaks which language"
          onClick={() => controller().swapLanguages()}
        >
          <ArrowLeftRight size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="chips">
        <ProviderChip kind="stt" />
        <ProviderChip kind="mt" />
        <ProviderChip kind="tts" />
      </div>

      <div className="topbar__actions">
        <button type="button" className="button" onClick={onOpenGuide}>
          <BookOpen size={16} aria-hidden="true" />
          Setup guide
        </button>
        <button type="button" className="button" onClick={onOpenSettings}>
          <Settings size={16} aria-hidden="true" />
          Settings
        </button>
      </div>
    </header>
  );
}
