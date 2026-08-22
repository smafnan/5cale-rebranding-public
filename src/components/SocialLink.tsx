"use client";

// Social hrefs are still "#" placeholders (see README). Swap in the real
// profile URLs before launch; until then, don't let the click jump the page.
export default function SocialLink({
  children,
  className = "link-sweep",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a href="#" onClick={(e) => e.preventDefault()} className={className}>
      {children}
    </a>
  );
}
