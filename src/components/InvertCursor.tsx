"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";

/**
 * The 5cale cursor: a pixel square that inverts whatever sits under it
 * (mix-blend-mode: difference). Grows over interactive elements, squashes
 * on press. Native pointer is hidden via CSS on precise pointers only.
 */
export default function InvertCursor() {
  const ref = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const dot = dotRef.current;
    if (!el || !dot) return;

    if (window.matchMedia("(pointer: coarse)").matches) {
      el.style.display = "none";
      return;
    }

    const xTo = gsap.quickTo(el, "x", { duration: 0.16, ease: "power3.out" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.16, ease: "power3.out" });

    const isInteractive = (t: EventTarget | null) =>
      t instanceof Element &&
      !!t.closest("a, button, input, textarea, select, label, [role='button']");

    const move = (e: PointerEvent) => {
      xTo(e.clientX);
      yTo(e.clientY);
    };
    const over = (e: PointerEvent) => {
      if (isInteractive(e.target)) {
        gsap.to(dot, { scale: 3.2, rotation: 45, duration: 0.35, ease: "power3.out" });
      }
    };
    const out = (e: PointerEvent) => {
      if (isInteractive(e.target)) {
        gsap.to(dot, { scale: 1, rotation: 0, duration: 0.35, ease: "power3.out" });
      }
    };
    const down = () => gsap.to(dot, { scale: 0.7, duration: 0.15, ease: "power2.out" });
    const up = () => gsap.to(dot, { scale: 1, duration: 0.3, ease: "back.out(2.2)" });

    window.addEventListener("pointermove", move);
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);

    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  return (
    <div ref={ref} className="pointer-events-none fixed left-0 top-0 z-[100]" aria-hidden>
      <div
        ref={dotRef}
        className="h-4 w-4 -translate-x-1/2 -translate-y-1/2 bg-white mix-blend-difference"
      />
    </div>
  );
}
