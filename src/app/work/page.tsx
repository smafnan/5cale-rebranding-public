import type { Metadata } from "next";
import WorkGrid from "@/components/work/WorkGrid";
import Reveal from "@/components/Reveal";

export const metadata: Metadata = {
  title: "Work",
  description: "Selected projects from the 5cale studio.",
};

export default function WorkPage() {
  return (
    <main id="main-content" tabIndex={-1} data-page-theme="base" className="px-5 pb-24 pt-36 md:px-8 focus:outline-none">
      <div className="mx-auto max-w-6xl">
        <p className="label mb-4 opacity-60">[ Selected work ]</p>
        <Reveal variant="wipe">
          <h1 className="font-slash mb-6 text-6xl md:text-[6.5vw]">
            Proof,
            <br />
            not promises.
          </h1>
        </Reveal>
        <Reveal variant="blur" delay={0.12}>
          <p className="mb-16 max-w-md text-lg opacity-80">
            A slice of what leaves the studio. Full case studies are being
            written. Ask us for the tour.
          </p>
        </Reveal>
        <WorkGrid />
      </div>
    </main>
  );
}
