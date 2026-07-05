"use client";

import { useState } from "react";
import Link from "next/link";
import FollowPreview from "@/components/FollowPreview";
import { SERVICES, THEMES } from "@/lib/data";

/**
 * The readymag/teachers walkthrough: rows open on hover (or tap) and a
 * floating act-colored preview card trails the pointer.
 */
export default function ServiceRows() {
  const [active, setActive] = useState<number | null>(null);
  const [last, setLast] = useState(0);

  const previewService = SERVICES[active ?? last];
  const previewTheme = THEMES[previewService.act.toLowerCase()] ?? THEMES.base;

  return (
    <>
      <div className="border-b border-current/15">
        {SERVICES.map((s, i) => {
          const open = active === i;
          return (
            <div
              key={s.title}
              className="border-t border-current/15"
              onMouseEnter={() => {
                setActive(i);
                setLast(i);
              }}
              onMouseLeave={() => setActive((v) => (v === i ? null : v))}
            >
              <button
                onClick={() => setActive(open ? null : i)}
                className="grid w-full cursor-pointer grid-cols-[2.5rem_1fr_2rem] items-baseline gap-4 py-5 text-left md:grid-cols-[3rem_1fr_10rem_2rem]"
                aria-expanded={open}
              >
                <span className="label opacity-50">{String(i + 1).padStart(2, "0")}</span>
                <span
                  className={`font-slash text-2xl transition-colors duration-300 md:text-4xl ${
                    open ? "text-[var(--accent)]" : ""
                  }`}
                >
                  {s.title}
                </span>
                <span className="label hidden opacity-50 md:block">Act · {s.act}</span>
                <span
                  className={`justify-self-end text-2xl transition-transform duration-300 ${
                    open ? "rotate-45 text-[var(--accent)]" : ""
                  }`}
                >
                  +
                </span>
              </button>

              <div
                className="grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
              >
                <div className="overflow-hidden">
                  <div className="flex flex-col gap-6 pb-9 md:flex-row md:items-start md:justify-between">
                    <p className="max-w-md text-base leading-relaxed opacity-80">{s.blurb}</p>
                    <div className="flex max-w-sm flex-wrap gap-2">
                      {s.deliverables.map((d) => (
                        <span key={d} className="chip">
                          {d}
                        </span>
                      ))}
                    </div>
                    <Link href="/contact" className="link-sweep label whitespace-nowrap">
                      Start →
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating act-colored preview (desktop) */}
      <FollowPreview active={active !== null}>
        <div className="w-40 overflow-hidden rounded-lg border border-white/20 shadow-2xl">
          <div
            className="flex h-24 items-center justify-center"
            style={{ background: previewTheme.bg }}
          >
            <span className="font-pixel text-2xl" style={{ color: previewTheme.accent }}>
              {previewService.act}
            </span>
          </div>
          <div className="bg-[#0b0b0b] px-3 py-2 text-[10px] uppercase tracking-widest text-white">
            {previewService.deliverables.length} deliverables ↗
          </div>
        </div>
      </FollowPreview>
    </>
  );
}
