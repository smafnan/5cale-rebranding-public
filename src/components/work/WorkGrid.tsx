"use client";

import { useState } from "react";
import Reveal, { RevealVariant } from "@/components/Reveal";
import ShatterTile from "@/components/ShatterTile";
import FollowPreview from "@/components/FollowPreview";
import { PROJECTS } from "@/lib/data";

// One distinct entrance per project (readymag variety + emergence shatter).
const FLOW: (RevealVariant | "shatter")[] = ["shatter", "flip", "wipe", "pop", "blur", "skew"];

function TileArt({ from, to, letter, tags }: { from: string; to: string; letter: string; tags: string }) {
  return (
    <>
      <div
        className="absolute inset-0 transition-transform duration-700 group-hover:scale-105"
        style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
      />
      <span
        aria-hidden
        className="font-pixel absolute -bottom-6 right-4 select-none text-[7rem] leading-none text-black/25 transition-transform duration-700 group-hover:-translate-y-3"
      >
        {letter}
      </span>
      <span className="label absolute left-4 top-4 rounded-full bg-black/25 px-3 py-1.5 text-white backdrop-blur">
        {tags}
      </span>
    </>
  );
}

export default function WorkGrid() {
  const [hover, setHover] = useState<number | null>(null);
  const [last, setLast] = useState(0);
  const preview = PROJECTS[hover ?? last];

  return (
    <>
      <div className="grid gap-x-6 gap-y-12 md:grid-cols-2">
        {PROJECTS.map((p, i) => {
          const variant = FLOW[i % FLOW.length];
          const shape = i % 3 === 0 ? "aspect-[16/9] md:aspect-[21/9]" : "aspect-[4/3]";
          const tile =
            variant === "shatter" ? (
              <div className={`relative overflow-hidden rounded-xl ${shape}`}>
                <ShatterTile from={p.from} to={p.to} scrub className="absolute inset-0" />
                <span
                  aria-hidden
                  className="font-pixel absolute -bottom-6 right-4 select-none text-[7rem] leading-none text-black/25"
                >
                  {p.title[0]}
                </span>
                <span className="label absolute left-4 top-4 rounded-full bg-black/25 px-3 py-1.5 text-white backdrop-blur">
                  {p.tags.join(" · ")}
                </span>
              </div>
            ) : (
              <Reveal variant={variant as RevealVariant}>
                <div className={`relative overflow-hidden rounded-xl ${shape}`}>
                  <TileArt from={p.from} to={p.to} letter={p.title[0]} tags={p.tags.join(" · ")} />
                </div>
              </Reveal>
            );

          return (
            <div
              key={p.title}
              className={`group ${i % 3 === 0 ? "md:col-span-2" : ""}`}
              onMouseEnter={() => {
                setHover(i);
                setLast(i);
              }}
              onMouseLeave={() => setHover((v) => (v === i ? null : v))}
            >
              {tile}
              <div className="mt-4 flex items-baseline justify-between">
                <h3 className="font-slash text-2xl md:text-3xl">{p.title}</h3>
                <span className="label opacity-50">{p.year}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Teachers-style floating preview while hovering a project */}
      <FollowPreview active={hover !== null}>
        <div className="w-44 overflow-hidden rounded-lg border border-white/20 shadow-2xl">
          <div
            className="h-28"
            style={{ background: `linear-gradient(135deg, ${preview.from}, ${preview.to})` }}
          />
          <div className="bg-[#0b0b0b] px-3 py-2 text-[10px] uppercase tracking-widest text-white">
            {preview.tags.join(" · ")} ↗
          </div>
        </div>
      </FollowPreview>
    </>
  );
}
