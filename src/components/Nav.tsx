"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { gsap } from "gsap";
import { NAV_LINKS, CONTACT_EMAIL } from "@/lib/data";
import LogoMark from "./LogoMark";

export default function Nav() {
  const [open, setOpen] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    if (open) {
      gsap.set(el, { pointerEvents: "auto" });
      gsap.to(el, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.7, ease: "power4.inOut" });
      gsap.fromTo(
        el.querySelectorAll("[data-menu-link]"),
        { yPercent: 120 },
        { yPercent: 0, duration: 0.6, stagger: 0.06, delay: 0.25, ease: "power3.out" }
      );
    } else {
      gsap.set(el, { pointerEvents: "none" });
      gsap.to(el, { clipPath: "inset(0% 0% 100% 0%)", duration: 0.55, ease: "power4.inOut" });
    }
  }, [open]);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-[70] flex items-center justify-between px-5 py-4 md:px-8">
        <Link href="/" onClick={close} className="flex items-center gap-2.5" aria-label="5cale home">
          <LogoMark className="h-6 w-auto text-[var(--accent)]" />
          <span className="font-pixel pt-0.5 text-lg tracking-wide md:text-xl">5CALE</span>
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/contact"
            className="hidden rounded-full border border-current px-5 py-2 text-xs uppercase tracking-[0.18em] transition-colors hover:bg-[var(--accent)] hover:text-[#0b0b0b] hover:border-[var(--accent)] md:block"
          >
            Start a project
          </Link>
          <button
            onClick={() => setOpen((v) => !v)}
            className="label cursor-pointer rounded-full border border-current px-5 py-2.5 transition-colors hover:bg-[var(--ink)] hover:text-[var(--bg)]"
            aria-expanded={open}
          >
            {open ? "Close ×" : "Menu +"}
          </button>
        </div>
      </header>

      {/* Fullscreen menu, always void-dark regardless of the current act */}
      <div
        ref={overlayRef}
        className="pointer-events-none fixed inset-0 z-[60] flex flex-col justify-between bg-[#0b0b0b] px-5 pb-10 pt-28 text-[#f4f1ea] md:px-8"
        style={{ clipPath: "inset(0% 0% 100% 0%)" }}
      >
        <nav className="flex flex-col">
          {NAV_LINKS.map((link, i) => (
            <div key={link.href} className="overflow-hidden border-b border-white/10">
              <Link
                data-menu-link
                href={link.href}
                onClick={close}
                className="font-slash group flex items-baseline gap-4 py-4 text-[11vw] leading-none transition-colors hover:text-[#d9ff3d] md:text-[5.5vw]"
              >
                <span className="label text-white/40 group-hover:text-[#d9ff3d]">0{i + 1}</span>
                {link.label}
              </Link>
            </div>
          ))}
        </nav>

        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <a href={`mailto:${CONTACT_EMAIL}`} className="link-sweep w-fit text-lg md:text-2xl">
            {CONTACT_EMAIL}
          </a>
          <p className="label text-white/40">Websites · Apps · Brands · Growth · AI</p>
        </div>
      </div>
    </>
  );
}
