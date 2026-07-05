import Link from "next/link";
import Reveal from "@/components/Reveal";
import ShatterTile from "@/components/ShatterTile";
import { PROJECTS } from "@/lib/data";

/**
 * Selected work: every card enters with its own move.
 * 0 shatters together (emergence), 1 flips in 3D, 2 wipes open.
 */
export default function WorkTeaser() {
  return (
    <section className="relative z-20 px-5 py-24 md:px-8 md:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 flex items-end justify-between">
          <h2 className="font-slash text-5xl md:text-7xl">
            Selected
            <br />
            work
          </h2>
          <Link href="/work" className="link-sweep label">
            All work ↗
          </Link>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {PROJECTS.slice(0, 3).map((p, i) => (
            <Link key={p.title} href="/work" className="group">
              {i === 0 ? (
                <div className="aspect-[4/5] overflow-hidden rounded-xl">
                  <div className="h-full w-full transition-transform duration-700 group-hover:scale-105">
                    <ShatterTile from={p.from} to={p.to} />
                  </div>
                </div>
              ) : (
                <Reveal variant={i === 1 ? "flip" : "wipe"} delay={i * 0.06}>
                  <div className="aspect-[4/5] overflow-hidden rounded-xl">
                    <div
                      className="h-full w-full transition-transform duration-700 group-hover:rotate-1 group-hover:scale-105"
                      style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
                    />
                  </div>
                </Reveal>
              )}
              <div className="mt-3 flex items-center justify-between">
                <h3 className="text-lg font-medium">{p.title}</h3>
                <span className="label opacity-50">{p.year}</span>
              </div>
              <p className="label mt-1 opacity-50">{p.tags.join(" · ")}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
