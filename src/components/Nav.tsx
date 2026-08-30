"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { gsap } from "gsap";
import { NAV_LINKS, CONTACT_EMAIL } from "@/lib/data";
import { lenisStore } from "@/lib/lenis-store";
import LogoMark from "./LogoMark";

export default function Nav() {
  const [open, setOpen] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Hand focus back to the toggle on the way out. The overlay goes `inert`
  // the instant `open` flips, and a focused descendant of an inert subtree
  // is blurred to <body> — so a keyboard user who Escapes out of the menu
  // would otherwise lose their place and tab from the top of the document.
  const close = () => {
    if (overlayRef.current?.contains(document.activeElement)) {
      toggleRef.current?.focus();
    }
    setOpen(false);
  };

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dur = reduced ? 0 : undefined;
    if (open) {
      gsap.set(el, { pointerEvents: "auto" });
      gsap.to(el, { clipPath: "inset(0% 0% 0% 0%)", duration: dur ?? 0.7, ease: "power4.inOut" });
      gsap.fromTo(
        el.querySelectorAll("[data-menu-link]"),
        { yPercent: reduced ? 0 : 120 },
        { yPercent: 0, duration: dur ?? 0.6, stagger: reduced ? 0 : 0.06, delay: reduced ? 0 : 0.25, ease: "power3.out" }
      );
    } else {
      gsap.set(el, { pointerEvents: "none" });
      gsap.to(el, { clipPath: "inset(0% 0% 100% 0%)", duration: dur ?? 0.55, ease: "power4.inOut" });
    }
  }, [open]);

  // Lock background scroll and allow Escape while the fullscreen menu is open.
  // Belt and braces: overflow:hidden blocks wheel/drag-driven scroll but not
  // programmatic scrollTo (which Lenis uses internally even while stopped),
  // so also swallow wheel/touch input directly, and snap back on any scroll
  // that still slips through so the page truly can't move underneath.
  // Events that originate inside the overlay itself are let through — on
  // short viewports the menu's own link list can exceed 100dvh, and it
  // needs to stay scrollable (see overflow-y-auto below) or those links
  // become unreachable.
  useEffect(() => {
    if (!open) return;
    const lockedY = window.scrollY;
    const root = document.documentElement;
    const prevOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    lenisStore.instance?.stop();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const blockScroll = (e: Event) => {
      if (e.target instanceof Node && overlayRef.current?.contains(e.target)) return;
      e.preventDefault();
    };
    const snapBack = () => {
      if (window.scrollY !== lockedY) window.scrollTo(0, lockedY);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", blockScroll, { passive: false });
    window.addEventListener("touchmove", blockScroll, { passive: false });
    window.addEventListener("scroll", snapBack);
    return () => {
      root.style.overflow = prevOverflow;
      lenisStore.instance?.start();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", blockScroll);
      window.removeEventListener("touchmove", blockScroll);
      window.removeEventListener("scroll", snapBack);
    };
  }, [open]);

  return (
    <>
      {/* Backdrop scrim: without it, large scrolling headlines read directly
          through the header and collide with the logo/menu button.
          While the menu is open the header sits ABOVE the overlay (z-70 vs
          z-60), so the scrim has to switch to the overlay's own void-dark
          instead of the page theme — on a light act (seed's #f2eee3, say)
          the page-tinted scrim under the forced #f4f1ea text lands at about
          1.6:1 contrast, and leaves a pale band across the top of an
          otherwise black menu. */}
      <header
        className={`fixed inset-x-0 top-0 z-[70] flex items-center justify-between px-5 py-4 backdrop-blur-md transition-colors duration-300 md:px-8 ${
          open ? "text-[#f4f1ea]" : ""
        }`}
        style={{
          background: open ? "#0b0b0b" : "color-mix(in srgb, var(--bg) 80%, transparent)",
        }}
      >
        <Link href="/" onClick={close} className="flex items-center gap-2.5" aria-label="5cale home">
          <LogoMark className={`h-6 w-auto ${open ? "text-[#d9ff3d]" : "text-[var(--accent)]"}`} />
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
            ref={toggleRef}
            onClick={() => setOpen((v) => !v)}
            className="label cursor-pointer rounded-full border border-current px-5 py-2.5 transition-colors hover:bg-[var(--ink)] hover:text-[var(--bg)]"
            aria-expanded={open}
          >
            {open ? "Close ×" : "Menu +"}
          </button>
        </div>
      </header>

      {/* Fullscreen menu, always void-dark regardless of the current act.
          inert while closed: the panel is only clipped out of view (see
          clipPath below), so its links stay in the DOM and would otherwise
          still be reachable by Tab and screen readers. */}
      <div
        ref={overlayRef}
        inert={!open}
        className="pointer-events-none fixed inset-0 z-[60] flex flex-col justify-between overflow-y-auto overscroll-contain bg-[#0b0b0b] px-5 pb-10 pt-28 text-[#f4f1ea] md:px-8"
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
