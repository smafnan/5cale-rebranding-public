"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { THEMES } from "@/lib/data";
import { scrollStore } from "@/lib/scroll-store";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

/**
 * The sang-neuf trick: sections tagged [data-act-theme] repaint the whole
 * site (--bg / --ink / --accent) as they cross the viewport center.
 * Also feeds page progress + act ranges into scrollStore for the 3D scene.
 */
export default function ThemeController() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.documentElement;

    const setTheme = (key: string, instant = false) => {
      const t = THEMES[key] ?? THEMES.base;
      const vars = { "--bg": t.bg, "--ink": t.ink, "--accent": t.accent };
      if (instant) gsap.set(root, vars);
      else gsap.to(root, { ...vars, duration: 0.8, ease: "power2.out", overwrite: "auto" });
    };

    // Pages can opt into a starting theme via <main data-page-theme="...">
    const pageEl = document.querySelector<HTMLElement>("[data-page-theme]");
    const baseKey = pageEl?.dataset.pageTheme ?? "base";
    setTheme(baseKey, true);
    scrollStore.act = 0;

    const sections = gsap.utils.toArray<HTMLElement>("[data-act-theme]");

    const triggers = sections.map((el, i) =>
      ScrollTrigger.create({
        trigger: el,
        start: "top 55%",
        end: "bottom 55%",
        onEnter: () => {
          setTheme(el.dataset.actTheme!);
          scrollStore.act = i + 1;
        },
        onEnterBack: () => {
          setTheme(el.dataset.actTheme!);
          scrollStore.act = i + 1;
        },
        onLeave: () => {
          if (i === sections.length - 1) {
            setTheme("base");
            scrollStore.act = sections.length + 1;
          }
        },
        onLeaveBack: () => {
          if (i === 0) {
            setTheme(baseKey);
            scrollStore.act = 0;
          }
        },
      })
    );

    // Whole-page progress for the 3D companion.
    const pageTrigger = ScrollTrigger.create({
      trigger: document.body,
      start: "top top",
      end: "bottom bottom",
      onUpdate: (self) => {
        scrollStore.progress = self.progress;
        scrollStore.velocity = self.getVelocity() / 4000;
      },
    });

    // Map each act section to a page-progress range for the 3D choreography.
    const measure = () => {
      const total = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      scrollStore.ranges = sections.map((el) => {
        const top = el.getBoundingClientRect().top + window.scrollY;
        return [top / total, (top + el.offsetHeight) / total] as [number, number];
      });
    };
    measure();
    ScrollTrigger.addEventListener("refresh", measure);
    ScrollTrigger.refresh();

    // Custom display fonts change layout heights when they land; re-measure
    // every trigger so entrances and act ranges stay in sync.
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) ScrollTrigger.refresh();
    });

    return () => {
      cancelled = true;
      triggers.forEach((t) => t.kill());
      pageTrigger.kill();
      ScrollTrigger.removeEventListener("refresh", measure);
      scrollStore.progress = 0;
      scrollStore.act = 0;
      scrollStore.ranges = [];
    };
  }, [pathname]);

  return null;
}
