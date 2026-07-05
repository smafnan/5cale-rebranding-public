import type { Metadata } from "next";
import WorkGrid from "@/components/work/WorkGrid";

export const metadata: Metadata = {
  title: "Work",
  description: "Selected projects from the 5cale studio.",
};

export default function WorkPage() {
  return (
    <main data-page-theme="base" className="px-5 pb-24 pt-36 md:px-8">
      <div className="mx-auto max-w-6xl">
        <p className="label mb-4 opacity-60">[ Selected work ]</p>
        <h1 className="display mb-6 text-6xl md:text-[7vw]">
          Proof,
          <br />
          not promises.
        </h1>
        <p className="mb-16 max-w-md text-lg opacity-80">
          A slice of what leaves the studio. Full case studies are being
          written — ask us for the tour.
        </p>
        <WorkGrid />
      </div>
    </main>
  );
}
