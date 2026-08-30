"use client";

import { ReactNode, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { gsap } from "gsap";

const emptySubscribe = () => () => {};

/**
 * Readymag/teachers-style hover preview: a floating card that trails the
 * pointer with a springy tilt while `active`. Desktop only.
 *
 * Portaled to <body> for the same reason as FiveScene: route pages are
 * wrapped in template.tsx's .page-enter, whose entrance animation leaves a
 * filled (animation-fill-mode: both) transform on the element even after it
 * finishes — any non-none transform (including one held by a completed
 * fill-mode animation) makes that element the containing block for
 * position:fixed descendants, so this card would scroll away with the page
 * instead of staying pinned to the viewport.
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
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  useEffect(() => {
    const el = outer.current;
    const card = inner.current;
    if (!el || !card) return;
    // Below md there's no room beside the content to trail a floating
    // preview without it landing on top of something.
    if (window.matchMedia("(pointer: coarse), (max-width: 767px)").matches) return;

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
    // mounted: the portal renders nothing (and outer/inner stay null) until
    // the post-hydration render, so this must re-run once that lands —
    // an empty dep array would capture null refs from the pre-portal pass
    // and never run again.
  }, [mounted]);

  useEffect(() => {
    const card = inner.current;
    if (!card) return;
    // Never reveal on touch/narrow viewports: the pointer effect above
    // never ran there, so the card would still be sitting unpositioned.
    const canFollow = !window.matchMedia("(pointer: coarse), (max-width: 767px)").matches;
    const show = active && canFollow;
    gsap.to(card, {
      scale: show ? 1 : 0,
      autoAlpha: show ? 1 : 0,
      duration: show ? 0.4 : 0.25,
      ease: show ? "back.out(1.8)" : "power2.in",
      overwrite: "auto",
    });
  }, [active, mounted]);

  if (!mounted) return null;

  return createPortal(
    <div ref={outer} className="pointer-events-none fixed left-0 top-0 z-[65]" aria-hidden>
      <div ref={inner} className="-translate-x-1/2 -translate-y-[110%] scale-0 opacity-0">
        {children}
      </div>
    </div>,
    document.body
  );
}
