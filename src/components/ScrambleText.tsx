"use client";

import { useEffect, useRef } from "react";

const CHARS = "5CALE#$%&/<>*+=";

/** Decodes text with a scramble effect the first time it enters the viewport. */
export default function ScrambleText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let raf = 0;
    const total = 26;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        const tick = () => {
          frame++;
          const reveal = Math.floor((frame / total) * text.length);
          el.textContent = text
            .split("")
            .map((c, i) =>
              i < reveal || c === " " ? c : CHARS[Math.floor(Math.random() * CHARS.length)]
            )
            .join("");
          if (frame < total) raf = requestAnimationFrame(tick);
          else el.textContent = text;
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 }
    );

    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [text]);

  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
}
