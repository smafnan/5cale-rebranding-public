"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { PROJECTS } from "@/lib/data";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export default function WorkGrid() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-work-card]", {
        y: 90,
        autoAlpha: 0,
        stagger: 0.1,
        duration: 0.9,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 75%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={ref} className="grid gap-x-6 gap-y-12 md:grid-cols-2">
      {PROJECTS.map((p, i) => (
        <div key={p.title} data-work-card className={`group ${i % 3 === 0 ? "md:col-span-2" : ""}`}>
          <div
            className={`relative overflow-hidden rounded-xl ${
              i % 3 === 0 ? "aspect-[16/9] md:aspect-[21/9]" : "aspect-[4/3]"
            }`}
          >
            <div
              className="absolute inset-0 transition-transform duration-700 group-hover:scale-105"
              style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
            />
            <span
              aria-hidden
              className="display absolute -bottom-8 right-4 select-none text-[9rem] leading-none text-black/15 transition-transform duration-700 group-hover:-translate-y-3"
            >
              {p.title[0]}
            </span>
            <span className="label absolute left-4 top-4 rounded-full bg-black/25 px-3 py-1.5 text-white backdrop-blur">
              {p.tags.join(" · ")}
            </span>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <h3 className="display text-2xl md:text-3xl">{p.title}</h3>
            <span className="label opacity-50">{p.year}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
