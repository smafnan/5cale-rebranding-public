"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { PROJECTS } from "@/lib/data";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export default function WorkTeaser() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-work-card]", {
        y: 80,
        autoAlpha: 0,
        stagger: 0.12,
        duration: 0.9,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 65%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={ref} className="relative z-20 px-5 py-32 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 flex items-end justify-between">
          <h2 className="display text-5xl md:text-7xl">
            Selected
            <br />
            work
          </h2>
          <Link href="/work" className="link-sweep label">
            All work ↗
          </Link>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {PROJECTS.slice(0, 3).map((p) => (
            <Link key={p.title} data-work-card href="/work" className="group">
              <div className="aspect-[4/5] overflow-hidden rounded-xl">
                <div
                  className="h-full w-full transition-transform duration-700 group-hover:rotate-1 group-hover:scale-105"
                  style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <h3 className="text-lg font-medium">{p.title}</h3>
                <span className="label opacity-50">{p.year}</span>
              </div>
              <p className="label mt-1 opacity-50">{p.tags.join(" · ")}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
