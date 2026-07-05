import Link from "next/link";
import Marquee from "@/components/Marquee";
import { CONTACT_EMAIL } from "@/lib/data";

export default function BigCTA() {
  return (
    <section className="relative z-20 py-16">
      <Marquee className="font-punk border-y border-current/15 py-4 text-2xl md:text-4xl" speed={20}>
        <span className="mx-6">Make it</span>
        <span className="text-[var(--accent)]">●</span>
        <span className="mx-6">Ship it</span>
        <span className="text-[var(--accent)]">●</span>
        <span className="mx-6">Grow it</span>
        <span className="text-[var(--accent)]">●</span>
        <span className="mx-6">5cale it</span>
        <span className="text-[var(--accent)]">●</span>
      </Marquee>

      <div className="flex flex-col items-center px-5 py-28 text-center md:py-32">
        <p className="label mb-6 opacity-60">[ Act ∞: yours ]</p>
        <h2 className="font-brick text-[13vw] leading-[0.95] md:text-[8.5vw]">
          Ready to
          <br />
          <span className="text-[var(--accent)]">5cale?</span>
        </h2>
        <div className="mt-10 flex flex-col items-center gap-4 md:flex-row">
          <Link
            href="/contact"
            className="rounded-full bg-[var(--accent)] px-8 py-4 text-sm font-medium uppercase tracking-wide text-[#0b0b0b] transition-transform hover:scale-105"
          >
            Start a project
          </Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="link-sweep text-sm uppercase tracking-wide">
            {CONTACT_EMAIL}
          </a>
        </div>
      </div>
    </section>
  );
}
