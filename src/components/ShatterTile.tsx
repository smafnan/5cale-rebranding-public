"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const COLS = 5;
const ROWS = 4;

/**
 * Emergence-style tile: the artwork arrives as scattered fragments that
 * fly together into a whole as you scroll.
 */
export default function ShatterTile({
  from,
  to,
  className = "",
  scrub = false,
}: {
  from: string;
  to: string;
  className?: string;
  scrub?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      gsap.from(el.querySelectorAll("[data-shard]"), {
        x: () => gsap.utils.random(-240, 240),
        y: () => gsap.utils.random(-200, 200),
        rotation: () => gsap.utils.random(-70, 70),
        autoAlpha: 0,
        stagger: 0.02,
        duration: 1,
        ease: "power3.out",
        scrollTrigger: scrub
          ? { trigger: el, start: "top 85%", end: "center 45%", scrub: 1 }
          : { trigger: el, start: "top 78%" },
      });
    }, el);

    return () => ctx.revert();
  }, [scrub]);

  return (
    <div ref={ref} className={`grid h-full w-full grid-cols-5 grid-rows-4 ${className}`} aria-hidden>
      {Array.from({ length: COLS * ROWS }).map((_, i) => {
        const c = i % COLS;
        const r = Math.floor(i / COLS);
        return (
          <div
            key={i}
            data-shard
            style={{
              backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
              backgroundSize: `${COLS * 100}% ${ROWS * 100}%`,
              backgroundPosition: `${(c / (COLS - 1)) * 100}% ${(r / (ROWS - 1)) * 100}%`,
            }}
          />
        );
      })}
    </div>
  );
}
