"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { cursorStore } from "@/lib/cursor-store";

// The cursor is the brand mark itself: the bitmap "5" from LogoMark.
const ROWS = ["XXXXX", "X....", "XXXX.", "....X", "....X", "X...X", ".XXX."];

/**
 * The 5cale cursor: a big pixel "5" that shows the opposite color of
 * whatever sits under it (white fill + mix-blend-mode: difference, so
 * every pixel underneath gets channel-inverted). Grows and tilts over
 * interactive elements, squashes on press. Native pointer is hidden
 * via CSS on precise pointers only.
 */
export default function InvertCursor() {
  const ref = useRef<HTMLDivElement>(null);
  const markRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = ref.current;
    const mark = markRef.current;
    if (!el || !mark) return;

    if (window.matchMedia("(pointer: coarse)").matches) {
      el.style.display = "none";
      return;
    }

    // Hidden until the pointer actually moves, so it never sits at 0,0.
    gsap.set(el, { autoAlpha: 0 });
    let seen = false;

    const xTo = gsap.quickTo(el, "x", {
      duration: 0.15,
      ease: "power3.out",
      onUpdate: () => {
        cursorStore.x = gsap.getProperty(el, "x") as number;
      },
    });
    const yTo = gsap.quickTo(el, "y", {
      duration: 0.15,
      ease: "power3.out",
      onUpdate: () => {
        cursorStore.y = gsap.getProperty(el, "y") as number;
      },
    });

    const isInteractive = (t: EventTarget | null) =>
      t instanceof Element &&
      !!t.closest("a, button, input, textarea, select, label, [role='button']");

    const move = (e: PointerEvent) => {
      if (!seen) {
        seen = true;
        gsap.set(el, { x: e.clientX, y: e.clientY });
        cursorStore.x = e.clientX;
        cursorStore.y = e.clientY;
        cursorStore.ready = true;
        gsap.to(el, { autoAlpha: 1, duration: 0.2 });
      }
      xTo(e.clientX);
      yTo(e.clientY);
    };
    const over = (e: PointerEvent) => {
      if (isInteractive(e.target)) {
        gsap.to(mark, { scale: 1.6, rotation: -12, duration: 0.35, ease: "power3.out" });
      }
    };
    const out = (e: PointerEvent) => {
      if (isInteractive(e.target)) {
        gsap.to(mark, { scale: 1, rotation: 0, duration: 0.35, ease: "power3.out" });
      }
    };
    const down = () => gsap.to(mark, { scale: 0.8, duration: 0.15, ease: "power2.out" });
    const up = () => gsap.to(mark, { scale: 1, rotation: 0, duration: 0.32, ease: "back.out(2.2)" });

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
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[100] mix-blend-difference"
    >
      <svg
        ref={markRef}
        viewBox="0 0 5 7"
        shapeRendering="crispEdges"
        className="h-10 w-auto -translate-x-1/2 -translate-y-1/2 fill-white"
      >
        {ROWS.flatMap((row, r) =>
          row.split("").map((cell, c) =>
            cell === "X" ? (
              <rect key={`${r}-${c}`} x={c + 0.05} y={r + 0.05} width={0.9} height={0.9} />
            ) : null
          )
        )}
      </svg>
    </div>
  );
}
