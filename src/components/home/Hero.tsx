"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { gsap } from "gsap";

export default function Hero() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-hero-char]", {
        yPercent: 115,
        duration: 0.9,
        stagger: 0.05,
        ease: "power4.out",
        delay: 0.15,
      });
      gsap.from("[data-hero-fade]", {
        y: 24,
        autoAlpha: 0,
        duration: 0.8,
        stagger: 0.08,
        delay: 0.7,
        ease: "power3.out",
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={ref}
      className="relative z-20 flex min-h-svh flex-col justify-between px-5 pb-8 pt-28 md:px-8"
    >
      <div data-hero-fade className="flex justify-between">
        <p className="label opacity-70">Digital growth studio</p>
        <p className="label hidden opacity-70 md:block">Websites — Apps — Brands — AI</p>
      </div>

      <h1 aria-label="5CALE" className="display select-none text-center text-[24vw] leading-[0.8] md:text-[20vw]">
        <span aria-hidden>
          {"5CALE".split("").map((c, i) => (
            <span key={i} className="inline-block overflow-hidden align-bottom">
              <span data-hero-char className="inline-block">
                {c}
              </span>
            </span>
          ))}
        </span>
      </h1>

      <div className="flex flex-col items-start gap-6 md:flex-row md:items-end md:justify-between">
        <p data-hero-fade className="max-w-md text-lg leading-snug md:text-xl">
          The growth studio for brands that refuse to stay small.
          From idea to inevitable — in five acts.
        </p>
        <div data-hero-fade className="flex items-center gap-3">
          <Link
            href="/contact"
            className="rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-medium uppercase tracking-wide text-[#0b0b0b] transition-transform hover:scale-105"
          >
            Start a project
          </Link>
          <Link
            href="/work"
            className="rounded-full border border-current px-6 py-3 text-sm uppercase tracking-wide transition-colors hover:bg-[var(--ink)] hover:text-[var(--bg)]"
          >
            See the work
          </Link>
        </div>
      </div>

      <p data-hero-fade className="label pt-8 text-center opacity-60">
        Scroll — the climb has five acts ↓
      </p>
    </section>
  );
}
