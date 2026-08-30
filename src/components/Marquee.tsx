import { CSSProperties, ReactNode } from "react";

/** Infinite marquee strip. Content is duplicated once; CSS scrolls -50%. */
export default function Marquee({
  children,
  className = "",
  speed = 24,
}: {
  children: ReactNode;
  className?: string;
  speed?: number;
}) {
  return (
    <div className={`overflow-hidden whitespace-nowrap ${className}`}>
      {/* One real, accessible copy for screen readers — the animated strip
          below repeats visually six times per half just to fill the track
          for a seamless loop, which would otherwise get announced 6x over. */}
      <span className="sr-only">{children}</span>
      <div
        aria-hidden
        className="animate-marquee inline-flex"
        style={{ "--marquee-speed": `${speed}s` } as CSSProperties}
      >
        {[0, 1].map((half) => (
          <span key={half} className="inline-flex shrink-0 items-center">
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className="inline-flex items-center">
                {children}
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}
