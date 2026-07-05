"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SERVICES } from "@/lib/data";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const TAGS = SERVICES.flatMap((s) => s.deliverables);

/** Readymag item-drop: every deliverable falls in and piles up with a bounce. */
export default function TagDrop() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-tag]", {
        y: -420,
        rotation: () => gsap.utils.random(-30, 30),
        autoAlpha: 0,
        duration: 1.2,
        stagger: 0.035,
        ease: "bounce.out",
        scrollTrigger: { trigger: ref.current, start: "top 65%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={ref} className="px-5 pb-16 pt-32 md:px-8">
      <p className="label mb-10 text-center opacity-60">[ Everything in the box ]</p>
      <div className="mx-auto flex max-w-4xl flex-wrap justify-center gap-2.5">
        {TAGS.map((t, i) => (
          <span key={`${t}-${i}`} data-tag className="chip">
            {t}
          </span>
        ))}
      </div>
    </section>
  );
}
