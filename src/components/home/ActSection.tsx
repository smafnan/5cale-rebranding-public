"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Act } from "@/lib/data";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

/** Per-act signature visual on the right column. */
function Signature({ act }: { act: Act }) {
  switch (act.key) {
    case "seed":
      return (
        <svg viewBox="0 0 300 200" className="w-full" fill="none" aria-hidden>
          <rect x="8" y="8" width="284" height="184" stroke="var(--ink)" strokeDasharray="6 6" opacity="0.35" />
          <path
            data-sketch-path
            d="M20 160 C 60 40, 120 40, 150 100 S 240 170, 280 40"
            stroke="var(--accent)"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "build":
      return (
        <div className="grid grid-cols-6 gap-1.5" aria-hidden>
          {Array.from({ length: 36 }).map((_, i) => (
            <div
              key={i}
              data-build-cell
              className={`aspect-square ${i % 7 === 0 ? "bg-[var(--accent)]" : "border border-current/40"}`}
            />
          ))}
        </div>
      );
    case "brand":
      return (
        <div className="display text-5xl leading-[0.95] md:text-[3.6vw]" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} data-stretch className={i === 1 ? "text-[var(--accent)]" : ""}>
              5CALE
            </div>
          ))}
        </div>
      );
    case "grow":
      return (
        <div className="flex h-48 items-end gap-3" aria-hidden>
          {[0.35, 0.5, 0.65, 0.82, 1].map((h, i) => (
            <div key={i} data-grow-bar className="w-10 bg-[var(--accent)]" style={{ height: `${h * 100}%` }} />
          ))}
        </div>
      );
    case "scale":
      return (
        <div className="relative flex h-56 w-56 items-center justify-center" aria-hidden>
          <div
            className="absolute inset-0 animate-spin rounded-full border border-dashed border-current/40"
            style={{ animationDuration: "14s" }}
          />
          <div
            className="absolute inset-6 animate-spin rounded-full border border-dotted border-[var(--accent)]"
            style={{ animationDuration: "9s", animationDirection: "reverse" }}
          />
          <span className="display text-6xl text-[var(--accent)]">5×</span>
        </div>
      );
  }
  return null;
}

export default function ActSection({ act }: { act: Act }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current!;
    const ctx = gsap.context(() => {
      gsap.from("[data-act-title]", {
        yPercent: 110,
        duration: 1,
        ease: "power4.out",
        scrollTrigger: { trigger: el, start: "top 70%" },
      });
      gsap.from("[data-act-fade]", {
        y: 30,
        autoAlpha: 0,
        stagger: 0.1,
        duration: 0.8,
        ease: "power3.out",
        scrollTrigger: { trigger: el, start: "top 60%" },
      });

      // Chips: GROW gets the readymag "drop & pile"; others pop in.
      const chips = el.querySelectorAll("[data-chip]");
      if (act.key === "grow") {
        gsap.from(chips, {
          y: -280,
          rotation: () => gsap.utils.random(-24, 24),
          autoAlpha: 0,
          duration: 1.1,
          stagger: 0.09,
          ease: "bounce.out",
          scrollTrigger: { trigger: el, start: "top 45%" },
        });
      } else {
        gsap.from(chips, {
          scale: 0.6,
          autoAlpha: 0,
          stagger: 0.06,
          duration: 0.5,
          ease: "back.out(2)",
          scrollTrigger: { trigger: el, start: "top 55%" },
        });
      }

      // Parallax on the giant hollow act number.
      gsap.fromTo(
        "[data-act-number]",
        { yPercent: 18 },
        {
          yPercent: -18,
          ease: "none",
          scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true },
        }
      );

      // — Per-act signature animations —
      if (act.key === "seed") {
        const path = el.querySelector<SVGPathElement>("[data-sketch-path]");
        if (path) {
          const len = path.getTotalLength();
          gsap.fromTo(
            path,
            { strokeDasharray: len, strokeDashoffset: len },
            {
              strokeDashoffset: 0,
              ease: "none",
              scrollTrigger: { trigger: el, start: "top 65%", end: "center 40%", scrub: 1 },
            }
          );
        }
      }
      if (act.key === "build") {
        // Scattered cells assemble into the grid (emergence reference).
        gsap.from("[data-build-cell]", {
          x: () => gsap.utils.random(-260, 260),
          y: () => gsap.utils.random(-200, 200),
          rotation: () => gsap.utils.random(-90, 90),
          autoAlpha: 0,
          ease: "power2.out",
          stagger: 0.012,
          scrollTrigger: { trigger: el, start: "top 60%", end: "center 45%", scrub: 1 },
        });
      }
      if (act.key === "brand") {
        // Kinetic variable-width type.
        gsap.fromTo(
          "[data-stretch]",
          { fontStretch: "62.5%" },
          {
            fontStretch: "125%",
            ease: "none",
            stagger: 0.05,
            scrollTrigger: { trigger: el, start: "top 70%", end: "center 40%", scrub: 1 },
          }
        );
      }
      if (act.key === "grow") {
        gsap.from("[data-grow-bar]", {
          scaleY: 0,
          transformOrigin: "bottom",
          stagger: 0.1,
          duration: 0.9,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 50%" },
        });
      }
    }, el);

    return () => ctx.revert();
  }, [act]);

  return (
    <section
      ref={ref}
      data-act-theme={act.key}
      className="relative z-20 flex min-h-[120vh] items-center px-5 py-32 md:px-8"
    >
      <div className="mx-auto grid w-full max-w-6xl items-center gap-14 md:grid-cols-12">
        <div className="md:col-span-7">
          <p data-act-fade className="label mb-4 opacity-60">
            [ Act {act.num} ]
          </p>
          <div className="overflow-hidden">
            <h2 data-act-title className="display text-[17vw] md:text-[9vw]">
              {act.title}
            </h2>
          </div>
          <p data-act-fade className="display mt-5 text-2xl text-[var(--accent)] md:text-4xl">
            {act.kicker}
          </p>
          <p data-act-fade className="mt-5 max-w-md text-base leading-relaxed opacity-80 md:text-lg">
            {act.copy}
          </p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            {act.chips.map((c) => (
              <span key={c} data-chip className="chip">
                {c}
              </span>
            ))}
          </div>
        </div>

        <div className="relative md:col-span-5">
          <div
            data-act-number
            aria-hidden
            className="display outline-text pointer-events-none absolute -top-28 right-0 -z-10 text-[38vw] opacity-40 md:text-[15vw]"
          >
            {act.num}
          </div>
          <Signature act={act} />
        </div>
      </div>
    </section>
  );
}
