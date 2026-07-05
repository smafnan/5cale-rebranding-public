"use client";

import { ReactNode, useEffect, useRef } from "react";
import { gsap } from "gsap";

/**
 * Readymag/teachers-style hover preview: a floating card that trails the
 * pointer with a springy tilt while `active`. Desktop only.
 */
export default function FollowPreview({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = outer.current;
    const card = inner.current;
    if (!el || !card) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const xTo = gsap.quickTo(el, "x", { duration: 0.45, ease: "power3.out" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.45, ease: "power3.out" });
    const rTo = gsap.quickTo(card, "rotation", { duration: 0.5, ease: "power2.out" });

    let lastX = 0;
    const move = (e: PointerEvent) => {
      xTo(e.clientX);
      yTo(e.clientY);
      rTo(gsap.utils.clamp(-16, 16, (e.clientX - lastX) * 0.7));
      lastX = e.clientX;
    };

    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, []);

  useEffect(() => {
    const card = inner.current;
    if (!card) return;
    gsap.to(card, {
      scale: active ? 1 : 0,
      autoAlpha: active ? 1 : 0,
      duration: active ? 0.4 : 0.25,
      ease: active ? "back.out(1.8)" : "power2.in",
      overwrite: "auto",
    });
  }, [active]);

  return (
    <div ref={outer} className="pointer-events-none fixed left-0 top-0 z-[65]" aria-hidden>
      <div ref={inner} className="-translate-x-1/2 -translate-y-[110%] scale-0 opacity-0">
        {children}
      </div>
    </div>
  );
}
