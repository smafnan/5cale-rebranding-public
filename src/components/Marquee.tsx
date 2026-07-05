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
      <div
        className="animate-marquee inline-flex"
        style={{ "--marquee-speed": `${speed}s` } as CSSProperties}
      >
        {[0, 1].map((half) => (
          <span key={half} aria-hidden={half === 1} className="inline-flex shrink-0 items-center">
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
