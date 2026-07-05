"use client";

import { ReactNode, useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export type RevealVariant = "rise" | "flip" | "wipe" | "pop" | "blur" | "skew";

/**
 * Scroll-triggered entrance with a distinct personality per variant,
 * so every asset can arrive differently (readymag-portfolio reference).
 */
export default function Reveal({
  variant = "rise",
  delay = 0,
  className = "",
  children,
}: {
  variant?: RevealVariant;
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const st = { trigger: el, start: "top 80%" };
    const ctx = gsap.context(() => {
      switch (variant) {
        case "flip":
          gsap.from(el, {
            rotationY: 80,
            transformOrigin: "left center",
            transformPerspective: 900,
            autoAlpha: 0,
            duration: 1,
            ease: "power3.out",
            delay,
            scrollTrigger: st,
          });
          break;
        case "wipe":
          gsap.fromTo(
            el,
            { clipPath: "inset(0 100% 0 0)" },
            { clipPath: "inset(0 0% 0 0)", duration: 1, ease: "power4.inOut", delay, scrollTrigger: st }
          );
          break;
        case "pop":
          gsap.from(el, {
            scale: 0.4,
            rotation: -6,
            autoAlpha: 0,
            duration: 0.8,
            ease: "back.out(1.6)",
            delay,
            scrollTrigger: st,
          });
          break;
        case "blur":
          gsap.fromTo(
            el,
            { filter: "blur(22px)", autoAlpha: 0, y: 40 },
            { filter: "blur(0px)", autoAlpha: 1, y: 0, duration: 1, ease: "power2.out", delay, scrollTrigger: st }
          );
          break;
        case "skew":
          gsap.from(el, {
            x: -140,
            skewX: 12,
            autoAlpha: 0,
            duration: 0.9,
            ease: "power3.out",
            delay,
            scrollTrigger: st,
          });
          break;
        default:
          gsap.from(el, {
            y: 70,
            autoAlpha: 0,
            duration: 0.9,
            ease: "power3.out",
            delay,
            scrollTrigger: st,
          });
      }
    }, el);

    return () => ctx.revert();
  }, [variant, delay]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
