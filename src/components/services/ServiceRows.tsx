"use client";

import { useState } from "react";
import Link from "next/link";
import { SERVICES } from "@/lib/data";

/**
 * The readymag/teachers walkthrough: rows that open on hover (or tap),
 * revealing the service's pitch and deliverables.
 */
export default function ServiceRows() {
  const [active, setActive] = useState<number | null>(null);

  return (
    <div className="border-b border-current/15">
      {SERVICES.map((s, i) => {
        const open = active === i;
        return (
          <div
            key={s.title}
            className="border-t border-current/15"
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive((v) => (v === i ? null : v))}
          >
            <button
              onClick={() => setActive(open ? null : i)}
              className="grid w-full cursor-pointer grid-cols-[2.5rem_1fr_2rem] items-baseline gap-4 py-5 text-left md:grid-cols-[3rem_1fr_10rem_2rem]"
              aria-expanded={open}
            >
              <span className="label opacity-50">{String(i + 1).padStart(2, "0")}</span>
              <span
                className={`display text-2xl transition-colors duration-300 md:text-4xl ${
                  open ? "text-[var(--accent)]" : ""
                }`}
              >
                {s.title}
              </span>
              <span className="label hidden opacity-50 md:block">Act — {s.act}</span>
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
  );
}
