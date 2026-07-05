import FiveScene from "@/components/three/FiveScene";
import Hero from "@/components/home/Hero";
import ActSection from "@/components/home/ActSection";
import WorkTeaser from "@/components/home/WorkTeaser";
import BigCTA from "@/components/home/BigCTA";
import Marquee from "@/components/Marquee";
import { ACTS } from "@/lib/data";

export default function Home() {
  return (
    <main data-page-theme="base">
      <FiveScene />
      <Hero />

      <Marquee className="label relative z-20 border-y border-current/15 py-3" speed={30}>
        <span className="mx-8">Websites</span>
        <span className="text-[var(--accent)]">✦</span>
        <span className="mx-8">Mobile apps</span>
        <span className="text-[var(--accent)]">✦</span>
        <span className="mx-8">Shopify</span>
        <span className="text-[var(--accent)]">✦</span>
        <span className="mx-8">Branding</span>
        <span className="text-[var(--accent)]">✦</span>
        <span className="mx-8">Content</span>
        <span className="text-[var(--accent)]">✦</span>
        <span className="mx-8">Marketing</span>
        <span className="text-[var(--accent)]">✦</span>
        <span className="mx-8">Social</span>
        <span className="text-[var(--accent)]">✦</span>
        <span className="mx-8">SEO</span>
        <span className="text-[var(--accent)]">✦</span>
        <span className="mx-8">AI</span>
        <span className="text-[var(--accent)]">✦</span>
      </Marquee>

      {ACTS.map((act) => (
        <ActSection key={act.key} act={act} />
      ))}

      <WorkTeaser />
      <BigCTA />
    </main>
  );
}
