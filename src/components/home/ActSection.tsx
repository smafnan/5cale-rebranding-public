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
        <div className="font-slash text-5xl leading-[1.05] md:text-[3.4vw]" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} data-stretch className={i === 1 ? "text-[var(--accent)]" : ""}>
              5CALE
            </div>
          ))}
        </div>
      );
    case "grow":
      return (
        <div className="flex h-40 items-end gap-3 md:h-48" aria-hidden>
          {[0.35, 0.5, 0.65, 0.82, 1].map((h, i) => (
            <div key={i} data-grow-bar className="w-8 bg-[var(--accent)] md:w-10" style={{ height: `${h * 100}%` }} />
          ))}
        </div>
      );
    case "scale":
      return (
        <div className="relative flex h-48 w-48 items-center justify-center md:h-56 md:w-56" aria-hidden>
          <div
            className="absolute inset-0 animate-spin rounded-full border border-dashed border-current/40"
            style={{ animationDuration: "14s" }}
          />
          <div
            className="absolute inset-6 animate-spin rounded-full border border-dotted border-[var(--accent)]"
            style={{ animationDuration: "9s", animationDirection: "reverse" }}
          />
          <span className="font-pixel text-5xl text-[var(--accent)] md:text-6xl">5X</span>
        </div>
      );
  }
  return null;
}

export default function ActSection({ act }: { act: Act }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current!;
    // Every animation below is a scroll-triggered gsap.from(), which
    // immediate-renders its "from" state the instant it's created (GSAP's
    // default for .from() tweens) regardless of scroll position — so for
    // reduced-motion we skip creating them at all rather than letting them
    // run, otherwise content would flash to a hidden/scattered state.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Parallax on the giant act number (desktop only, where it's absolute —
    // in-flow on mobile, so animating it there would just jitter the layout).
    // Tracked outside gsap.context and re-synced on resize so crossing the
    // 768px breakpoint mid-session (not just at mount) turns it on/off.
    let numberTween: gsap.core.Tween | null = null;
    const syncNumberParallax = () => {
      // Scoped to this section's own DOM subtree via el.querySelectorAll —
      // a plain string selector here would match every act section's
      // number on the page, since this runs outside gsap.context's
      // automatic selector-text scoping (see below).
      const numberEl = el.querySelectorAll("[data-act-number]");
      const isDesktop = window.matchMedia("(min-width: 768px)").matches;
      if (isDesktop && !numberTween) {
        numberTween = gsap.fromTo(
          numberEl,
          { yPercent: 14 },
          {
            yPercent: -14,
            ease: "none",
            scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true },
          }
        );
      } else if (!isDesktop && numberTween) {
        numberTween.scrollTrigger?.kill();
        numberTween.kill();
        numberTween = null;
        gsap.set(numberEl, { yPercent: 0 });
      }
    };

    const ctx = gsap.context(() => {
      const chars = el.querySelectorAll("[data-act-char]");
      const title = el.querySelector("[data-act-title]");
      const enter = { trigger: el, start: "top 70%" };

      // Every act's title arrives with its own move (readymag variety).
      switch (act.key) {
        case "seed":
          gsap.fromTo(
            title,
            { clipPath: "inset(0 100% 0 0)" },
            { clipPath: "inset(0 -5% 0 0)", duration: 1.1, ease: "power4.inOut", scrollTrigger: enter }
          );
          break;
        case "build":
          // Emergence: letters fly in from scattered positions and assemble.
          gsap.from(chars, {
            x: () => gsap.utils.random(-180, 180),
            y: () => gsap.utils.random(-140, 140),
            rotation: () => gsap.utils.random(-50, 50),
            autoAlpha: 0,
            duration: 1,
            stagger: 0.05,
            ease: "power3.out",
            scrollTrigger: enter,
          });
          break;
        case "brand":
          gsap.from(title, {
            scaleX: 1.7,
            transformOrigin: "left center",
            autoAlpha: 0,
            duration: 1,
            ease: "power3.out",
            scrollTrigger: enter,
          });
          break;
        case "grow":
          gsap.from(chars, {
            yPercent: 130,
            autoAlpha: 0,
            duration: 0.8,
            stagger: 0.06,
            ease: "back.out(2)",
            scrollTrigger: enter,
          });
          break;
        case "scale":
          gsap.fromTo(
            title,
            { filter: "blur(18px)", letterSpacing: "0.3em", autoAlpha: 0 },
            {
              filter: "blur(0px)",
              letterSpacing: "0.01em",
              autoAlpha: 1,
              duration: 1.1,
              ease: "power2.out",
              scrollTrigger: enter,
            }
          );
          break;
      }

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

      // Per-act signature animations.
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
        gsap.from("[data-stretch]", {
          xPercent: -30,
          scaleX: 2.2,
          transformOrigin: "left center",
          autoAlpha: 0,
          stagger: 0.08,
          ease: "none",
          scrollTrigger: { trigger: el, start: "top 70%", end: "center 40%", scrub: 1 },
        });
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

    syncNumberParallax();
    window.addEventListener("resize", syncNumberParallax);

    return () => {
      ctx.revert();
      window.removeEventListener("resize", syncNumberParallax);
      numberTween?.scrollTrigger?.kill();
      numberTween?.kill();
    };
  }, [act]);

  return (
    <section
      ref={ref}
      data-act-theme={act.key}
      className="relative z-20 flex min-h-[100svh] items-center overflow-x-clip px-5 py-24 md:min-h-[120vh] md:px-8 md:py-32"
    >
      <div className="mx-auto grid w-full max-w-6xl items-center gap-10 md:grid-cols-12 md:gap-14">
        <div className="md:col-span-7">
          <p data-act-fade className="label mb-4 opacity-60">
            [ Act {act.num} ]
          </p>
          <h2
            data-act-title
            aria-label={act.title}
            className="font-slash text-[16vw] md:text-[8.5vw]"
          >
            <span aria-hidden>
              {act.title.split("").map((c, i) => (
                <span key={i} data-act-char className="inline-block">
                  {c}
                </span>
              ))}
            </span>
          </h2>
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
            className="font-brickline pointer-events-none mb-4 text-right text-[24vw] leading-none text-[var(--accent)] opacity-60 md:absolute md:-top-28 md:right-0 md:mb-0 md:text-[12vw]"
          >
            {act.num}
          </div>
          <Signature act={act} />
        </div>
      </div>
    </section>
  );
}
