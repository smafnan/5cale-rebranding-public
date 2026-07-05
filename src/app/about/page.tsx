import type { Metadata } from "next";
import Link from "next/link";
import Marquee from "@/components/Marquee";
import ScrambleText from "@/components/ScrambleText";
import Reveal from "@/components/Reveal";
import { ACTS } from "@/lib/data";

export const metadata: Metadata = {
  title: "About",
  description: "5cale is a growth studio: strategy, build, brand, growth and AI under one roof.",
};

export default function AboutPage() {
  return (
    <main data-page-theme="seed" className="pb-24 pt-36">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <p className="label mb-4 opacity-60">
          [ <ScrambleText text="The studio" /> ]
        </p>
        <Reveal variant="wipe">
          <h1 className="font-slash max-w-4xl text-5xl leading-[1.02] md:text-[5vw]">
            Growth has a shape. It looks like a staircase.
          </h1>
        </Reveal>
        <Reveal variant="blur" delay={0.15}>
          <p className="mt-8 max-w-lg text-lg leading-relaxed opacity-80">
            5cale is a digital growth studio. One team for strategy, design,
            engineering, content and AI, so nothing gets lost between agencies
            and every act builds on the last one.
          </p>
        </Reveal>

        {/* The five, each row sliding in differently */}
        <div className="mt-24 border-b border-current/15">
          {ACTS.map((act, i) => (
            <Reveal key={act.key} variant={i % 2 === 0 ? "skew" : "pop"} delay={i * 0.04}>
              <div className="grid grid-cols-[3rem_1fr] items-baseline gap-4 border-t border-current/15 py-6 md:grid-cols-[6rem_16rem_1fr]">
                <span className="label opacity-50">Act {act.num}</span>
                <h2 className="font-slash text-3xl md:text-4xl">{act.title}</h2>
                <p className="col-span-2 mt-2 opacity-70 md:col-span-1 md:mt-0">{act.kicker}</p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Numbers with attitude */}
        <div className="mt-24 grid gap-10 text-center md:grid-cols-3">
          {[
            ["5", "acts in every engagement"],
            ["10", "services under one roof"],
            ["∞", "iterations until it's right"],
          ].map(([n, l], i) => (
            <Reveal key={l} variant="pop" delay={i * 0.08}>
              <p className="font-pixel text-7xl text-[var(--accent)] md:text-8xl">{n}</p>
              <p className="label mt-3 opacity-60">{l}</p>
            </Reveal>
          ))}
        </div>
      </div>

      <Marquee className="font-punk mt-24 border-y border-current/15 py-4 text-xl md:text-3xl" speed={26}>
        <span className="mx-6">Bold by default</span>
        <span className="text-[var(--accent)]">✦</span>
        <span className="mx-6">Ship weekly</span>
        <span className="text-[var(--accent)]">✦</span>
        <span className="mx-6">Details are the product</span>
        <span className="text-[var(--accent)]">✦</span>
        <span className="mx-6">AI-native</span>
        <span className="text-[var(--accent)]">✦</span>
      </Marquee>

      <div className="mt-24 flex flex-col items-center gap-6 px-5 text-center">
        <h2 className="font-slash text-4xl md:text-6xl">Sound like your kind of team?</h2>
        <Link
          href="/contact"
          className="rounded-full bg-[var(--accent)] px-8 py-4 text-sm font-medium uppercase tracking-wide text-[#0b0b0b] transition-transform hover:scale-105"
        >
          Start a project
        </Link>
      </div>
    </main>
  );
}
