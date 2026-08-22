"use client";

import { ReactNode, useEffect } from "react";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { lenisStore } from "@/lib/lenis-store";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

/** Lenis smooth scrolling, driven by GSAP's ticker and synced to ScrollTrigger. */
export default function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({ duration: 1.15 });
    const raf = (time: number) => lenis.raf(time * 1000);

    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    lenisStore.instance = lenis;

    return () => {
      gsap.ticker.remove(raf);
      lenis.destroy();
      lenisStore.instance = null;
    };
  }, []);

  return <>{children}</>;
}
