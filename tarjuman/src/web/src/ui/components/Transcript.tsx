import { ArrowDown, Download, Keyboard, Volume2 } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { LANGUAGES, type LangCode } from '../../../../shared/languages';
import type { DropReason } from '../../../../shared/protocol';
import { useAppStore } from '../../state/store';
import type { TranscriptEntry, TranscriptExportFormat } from '../../state/types';
import { controller } from '../controller';
import { useDismissable } from '../hooks/useDismissable';
import { CHANNEL_COPY } from '../lib/channels';
import { cx } from '../lib/cx';
import { formatClock, formatSeconds } from '../lib/format';
import { Spinner } from './controls';
import { LangText } from './LangText';

/** How close to the bottom still counts as "following the conversation". */
const FOLLOW_THRESHOLD_PX = 80;
/** Above this, the delay is long enough to be worth pointing out. */
const SLOW_LATENCY_MS = 4_000;

const DROP_TEXT: Record<DropReason, string> = {
  no_speech: 'No speech detected — ignored',
  hallucination: 'Not speech — ignored',
  too_short: 'Too short — ignored',
  too_long: 'Too long — ignored',
  cancelled: 'Cancelled',
};

const Entry = memo(function Entry({ entry }: { entry: TranscriptEntry }) {
  const copy = CHANNEL_COPY[entry.channel];

  if (entry.status === 'dropped') {
    if (!entry.sourceText) return null;
    return (
      <li className={`entry entry--${entry.channel} entry--muted`}>
        <span>
          {formatClock(entry.createdAt)} · {copy.tag} · {DROP_TEXT[entry.dropReason ?? 'hallucination']}
        </span>
      </li>
    );
  }

  const target = entry.translations[entry.targetLang];
  const extras = (Object.keys(entry.translations) as LangCode[]).filter(
    (lang) => lang !== entry.targetLang && lang !== entry.sourceLang && entry.translations[lang],
  );
  const working = entry.status === 'transcribing' || entry.status === 'translating';

  return (
    <li className={`entry entry--${entry.channel}`}>
      <div className="entry__meta">
        <span className={`tag tag--${entry.channel}`}>{copy.tag}</span>
        <time dateTime={new Date(entry.createdAt).toISOString()}>{formatClock(entry.createdAt)}</time>
        {entry.typed ? (
          <span title="Typed">
            <Keyboard size={13} aria-label="Typed" />
          </span>
        ) : null}
        {working ? <Spinner size={13} /> : null}
        {entry.status === 'speaking' ? <Volume2 size={13} aria-label="Speaking" /> : null}
        {entry.latencyMs !== null ? (
          <span
            className={cx('badge', entry.latencyMs > SLOW_LATENCY_MS && 'badge--warn')}
            title="Time from the end of the sentence until the translated voice started"
          >
            {formatSeconds(entry.latencyMs)}
          </span>
        ) : null}
      </div>

      {entry.sourceText ? (
        <LangText lang={entry.sourceLang} as="p" className="entry__source">
          {entry.sourceText}
        </LangText>
      ) : (
        <p className="entry__source">
          <span className="skeleton" /> <span className="visually-hidden">Listening…</span>
        </p>
      )}

      {target ? (
        <LangText lang={entry.targetLang} as="p" className="entry__target">
          {target}
        </LangText>
      ) : entry.status === 'translating' ? (
        <p className="entry__target">
          <span className="skeleton" />
        </p>
      ) : null}

      {extras.map((lang) => (
        <p key={lang} className="entry__extra">
          <span className="entry__lang">{LANGUAGES[lang].code}</span>
          <LangText lang={lang}>{entry.translations[lang]}</LangText>
        </p>
      ))}

      {entry.status === 'error' ? (
        <p className="entry__error">{entry.error ?? 'Something went wrong.'}</p>
      ) : null}
      {entry.status !== 'error' && entry.error ? <p className="entry__note">{entry.error}</p> : null}
    </li>
  );
});

function ExportMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, wrap, close);
  const choose = (format: TranscriptExportFormat) => () => {
    setOpen(false);
    controller().exportTranscript(format);
  };
  return (
    <div className="menu" ref={wrap}>
      <button
        type="button"
        className="button button--quiet button--small"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Download size={14} aria-hidden="true" /> Export
      </button>
      {open ? (
        <div className="menu__list" role="menu">
          <button type="button" role="menuitem" onClick={choose('markdown')}>
            Markdown
          </button>
          <button type="button" role="menuitem" onClick={choose('text')}>
            Plain text
          </button>
          <button type="button" role="menuitem" onClick={choose('json')}>
            JSON
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Toolbar({ hasEntries }: { hasEntries: boolean }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="toolbar">
      <span className="toolbar__title">Conversation</span>
      <div className="toolbar__actions">
        <button
          type="button"
          className="button button--quiet button--small"
          title="Forget the conversation context used for translation"
          onClick={() => controller().resetContext()}
        >
          New topic
        </button>
        <ExportMenu />
        {confirming ? (
          <>
            <button
              type="button"
              className="button button--danger button--small"
              onClick={() => {
                setConfirming(false);
                controller().clearTranscript();
              }}
            >
              Clear everything
            </button>
            <button
              type="button"
              className="button button--quiet button--small"
              onClick={() => setConfirming(false)}
            >
              Keep
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button button--quiet button--small"
            disabled={!hasEntries}
            onClick={() => setConfirming(true)}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onOpenGuide }: { onOpenGuide: () => void }) {
  return (
    <div className="empty">
      <h2>Nothing has been said yet</h2>
      <ol>
        <li>
          Add a free API key under <strong>Settings</strong> so Tarjuman can understand speech.
        </li>
        <li>
          Press <strong>Start microphone</strong> and speak. Pause briefly between sentences.
        </li>
        <li>
          Press <strong>Capture their audio</strong> to hear the other side in your language.
        </li>
      </ol>
      <p>
        To use it in a Teams call, follow the{' '}
        <button type="button" className="button button--small" onClick={onOpenGuide}>
          setup guide
        </button>
      </p>
      <p className="small">You can also type below instead of speaking.</p>
    </div>
  );
}

export function Transcript({ onOpenGuide }: { onOpenGuide: () => void }) {
  const transcript = useAppStore((state) => state.transcript);
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToEnd = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    following.current = true;
    setShowJump(false);
  }, []);

  // Keep the newest sentence in view, unless the reader has scrolled up to look at something.
  useLayoutEffect(() => {
    if (following.current) scrollToEnd();
    else setShowJump(true);
  }, [transcript, scrollToEnd]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      following.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX;
      if (following.current) setShowJump(false);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <Toolbar hasEntries={transcript.length > 0} />
      <div className="transcript">
        <div className="transcript__scroll" ref={scroller}>
          {transcript.length === 0 ? (
            <EmptyState onOpenGuide={onOpenGuide} />
          ) : (
            <ol className="transcript__list">
              {transcript.map((entry) => (
                <Entry key={entry.id} entry={entry} />
              ))}
            </ol>
          )}
        </div>
        {showJump && transcript.length > 0 ? (
          <button type="button" className="button button--primary button--small jump" onClick={scrollToEnd}>
            <ArrowDown size={14} aria-hidden="true" /> Jump to latest
          </button>
        ) : null}
      </div>
    </>
  );
}
