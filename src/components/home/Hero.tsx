"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import HeroBackdrop from "@/components/home/HeroBackdrop";

gsap.registerPlugin(ScrollTrigger);

// Where each letter of 5CALE flies as you scroll down (fractions of the
// viewport, so the dispersion scales with the screen). Middle letter
// drifts straight up; the rest scatter outward.
const SCATTER_X = [-0.42, -0.2, 0.02, 0.24, 0.46];
const SCATTER_Y = [-0.16, 0.28, -0.34, 0.22, -0.12];
const SCATTER_R = [-32, 22, -12, 28, -24];

export default function Hero() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const ctx = gsap.context(() => {
      gsap.from("[data-hero-char]", {
        y: 90,
        autoAlpha: 0,
        duration: 0.9,
        stagger: 0.06,
        ease: "back.out(1.4)",
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

      if (reduced) return;

      // Scroll down and the word breaks apart: every letter departs on
      // its own trajectory, scrubbed to the scrollbar so it reassembles
      // when you come back up.
      gsap.utils.toArray<HTMLElement>("[data-hero-scatter]").forEach((el, i) => {
        gsap.to(el, {
          x: () => SCATTER_X[i % 5] * window.innerWidth,
          y: () => SCATTER_Y[i % 5] * window.innerHeight,
          rotation: SCATTER_R[i % 5],
          opacity: 0,
          ease: "none",
          scrollTrigger: {
            trigger: ref.current,
            start: "top top",
            end: "bottom 25%",
            scrub: true,
            invalidateOnRefresh: true,
          },
        });
      });

      // The galaxy collage lags behind and dims, cheap parallax depth.
      gsap.to("[data-hero-backdrop]", {
        yPercent: 16,
        opacity: 0.15,
        ease: "none",
        scrollTrigger: {
          trigger: ref.current,
          start: "top top",
          end: "bottom top",
          scrub: true,
          invalidateOnRefresh: true,
        },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={ref}
      className="relative z-20 flex min-h-svh flex-col justify-between px-5 pb-8 pt-28 md:px-8"
    >
      <HeroBackdrop />

      <div data-hero-fade className="flex justify-between">
        <p className="label opacity-70">Digital growth studio</p>
        <p className="label hidden opacity-70 md:block">Websites · Apps · Brands · AI</p>
      </div>

      <h1
        aria-label="5CALE"
        className="font-pixel select-none text-center text-[19vw] leading-none md:text-[15.5vw]"
      >
        <span aria-hidden>
          {"5CALE".split("").map((c, i) => (
            <span key={i} data-hero-scatter className="inline-block will-change-transform">
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
          From idea to inevitable, in five acts.
        </p>
        <div data-hero-fade className="flex flex-wrap items-center gap-3">
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
        Scroll. The climb has five acts ↓
      </p>
    </section>
  );
}
