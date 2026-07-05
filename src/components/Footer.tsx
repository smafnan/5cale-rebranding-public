import Link from "next/link";
import { NAV_LINKS, CONTACT_EMAIL } from "@/lib/data";
import LogoMark from "./LogoMark";

export default function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-current/15 px-5 pb-8 pt-16 md:px-8">
      <div className="mb-14 flex flex-col gap-10 md:flex-row md:justify-between">
        <div className="max-w-sm">
          <LogoMark className="mb-5 h-7 w-auto text-[var(--accent)]" />
          <p className="text-sm leading-relaxed opacity-70">
            The growth studio for brands that refuse to stay small. Strategy,
            build, brand, growth and AI, in five acts.
          </p>
        </div>

        <div className="flex gap-16">
          <nav className="flex flex-col gap-2">
            <span className="label mb-2 opacity-50">Menu</span>
            {NAV_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="link-sweep w-fit text-sm">
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex flex-col gap-2">
            <span className="label mb-2 opacity-50">Talk</span>
            <a href={`mailto:${CONTACT_EMAIL}`} className="link-sweep w-fit text-sm">
              {CONTACT_EMAIL}
            </a>
            <a href="#" className="link-sweep w-fit text-sm">Instagram</a>
            <a href="#" className="link-sweep w-fit text-sm">LinkedIn</a>
            <a href="#" className="link-sweep w-fit text-sm">X / Twitter</a>
          </div>
        </div>
      </div>

      {/* Giant hollow pixel wordmark */}
      <div
        aria-hidden
        className="font-pixel outline-text select-none text-center text-[19vw] leading-none"
      >
        5CALE
      </div>

      <div className="mt-6 flex flex-col gap-1 text-xs opacity-50 md:flex-row md:justify-between">
        <span>© 2026 5cale. Built to multiply.</span>
        <span>From idea to inevitable.</span>
      </div>
    </footer>
  );
}
