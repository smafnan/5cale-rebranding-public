"use client";

import { useEffect, useRef, useState } from "react";
import LogoMark from "@/components/LogoMark";

type Msg = { from: "bot" | "user"; text: string };

// NOTE: front-end shell only. Wire these canned replies to the real
// AI backend when it lands; the message list and input are ready.
const REPLIES = [
  "Good question. My brain is still being wired in, a human from the studio will pick this up.",
  "Noted. While my backend is in the oven, the Services page has most answers.",
  "I am mostly decorative right now, but the team reads everything. Drop your email in the contact form and they will reply fast.",
];

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([
    { from: "bot", text: "Hey! I am the 5CALE bot. Ask about the five acts, the work, or where to start." },
  ]);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const replyCount = useRef(0);

  // Keep the newest message in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [msgs, open]);

  // Escape closes the panel. Move focus out first if it's currently inside
  // the panel (e.g. the message input) — the panel gets aria-hidden the
  // instant it closes, and a focused descendant of an aria-hidden element
  // is an ARIA violation with undefined assistive-tech behavior.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (panelRef.current?.contains(document.activeElement)) {
        toggleRef.current?.focus();
      }
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    setMsgs((m) => [...m, { from: "user", text }]);
    const reply = REPLIES[replyCount.current % REPLIES.length];
    replyCount.current += 1;
    window.setTimeout(() => {
      setMsgs((m) => [...m, { from: "bot", text: reply }]);
    }, 700);
  };

  return (
    <div className="fixed bottom-5 right-5 z-[95]" data-lenis-prevent>
      {/* Panel */}
      <div
        ref={panelRef}
        className={`absolute bottom-16 right-0 w-[min(21rem,calc(100vw-2.5rem))] origin-bottom-right overflow-hidden rounded-2xl border border-white/10 bg-[#101014] shadow-2xl transition-all duration-300 ${
          open
            ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
            : "pointer-events-none translate-y-3 scale-95 opacity-0"
        }`}
        role="dialog"
        aria-label="Chat with the 5CALE bot"
        aria-hidden={!open}
        inert={!open}
      >
        <div className="flex items-center gap-2.5 border-b border-white/10 bg-white/[0.03] px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#d9ff3d]">
            <LogoMark className="h-4 w-auto text-[#0b0b0b]" />
          </span>
          <div>
            <p className="font-pixel text-sm leading-none text-white">5CALE AI</p>
            <p className="mt-1 flex items-center gap-1.5 text-[10px] text-white/45">
              <span className="h-1.5 w-1.5 rounded-full bg-[#5bf1a6]" />
              online, sort of
            </p>
          </div>
        </div>

        <div
          ref={listRef}
          role="log"
          aria-live="polite"
          className="flex h-72 flex-col gap-2 overflow-y-auto px-3 py-3"
        >
          {msgs.map((m, i) =>
            m.from === "bot" ? (
              <p key={i} className="max-w-[85%] self-start rounded-xl rounded-bl-sm bg-white/10 px-3 py-2 text-sm leading-snug text-white/90">
                {m.text}
              </p>
            ) : (
              <p key={i} className="max-w-[85%] self-end rounded-xl rounded-br-sm bg-[#d9ff3d] px-3 py-2 text-sm leading-snug text-[#0b0b0b]">
                {m.text}
              </p>
            )
          )}
        </div>

        <form onSubmit={send} className="flex items-center gap-2 border-t border-white/10 px-3 py-2.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message"
            aria-label="Message for the 5CALE bot"
            className="w-full rounded-md bg-transparent px-1 py-1.5 text-sm text-white outline-none placeholder:text-white/35 focus-visible:outline-2 focus-visible:outline-[#d9ff3d]"
          />
          <button
            type="submit"
            aria-label="Send message"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#d9ff3d] text-sm text-[#0b0b0b] transition-transform hover:scale-110"
          >
            →
          </button>
        </form>
      </div>

      {/* Toggle */}
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close chat" : "Chat with 5CALE AI"}
        aria-expanded={open}
        className="relative flex h-13 w-13 items-center justify-center rounded-full bg-[#d9ff3d] shadow-xl transition-transform hover:scale-110"
      >
        {open ? (
          <span className="text-xl leading-none text-[#0b0b0b]">×</span>
        ) : (
          <LogoMark className="h-5 w-auto text-[#0b0b0b]" />
        )}
        {!open && (
          <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-[#0b0b0b] bg-[#5bf1a6]" />
        )}
      </button>
    </div>
  );
}
