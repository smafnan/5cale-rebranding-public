"use client";

import { useEffect, useRef } from "react";
import LogoMark from "@/components/LogoMark";

/* Everything the studio makes, floating behind the title: running code,
   a social post going live, an infographic, marker doodles, pixel art,
   all drifting through a slow-moving pixel galaxy. */

const CODE_LINES: [string, string][] = [
  ["$ npm create 5cale@latest", "text-white/45"],
  ["> scaffolding growth engine", "text-white/30"],
  ["const acts = [seed, build,", "text-[#71f6ff]/85"],
  ["  brand, grow, scale]", "text-[#71f6ff]/85"],
  ["let value = 1", "text-white/60"],
  ["acts.forEach(() =>", "text-white/60"],
  ["  value *= 5)", "text-[#a98bff]/90"],
  ["// value = 3125, ship it", "text-white/30"],
  ['deploy({ brand: "5CALE" })', "text-[#d9ff3d]/90"],
  ["✓ live in production", "text-[#5bf1a6]/85"],
];

/* Pixel rocket sprite, two flame frames. */
const ROCKET_BODY: [number, number][] = [
  [3, 0],
  [2, 1], [3, 1], [4, 1],
  [2, 2], [4, 2],
  [2, 3], [3, 3], [4, 3],
  [2, 4], [3, 4], [4, 4],
  [2, 5], [3, 5], [4, 5],
];
const ROCKET_FINS: [number, number][] = [
  [1, 4], [0, 5], [1, 5],
  [5, 4], [6, 5], [5, 5],
];
const FLAME_A: [number, number][] = [[3, 6], [2, 7], [3, 7], [4, 7], [3, 8], [3, 9]];
const FLAME_B: [number, number][] = [[3, 6], [2, 7], [3, 7], [4, 7]];

const px = (cells: [number, number][], fill: string, key: string) =>
  cells.map(([x, y], i) => (
    <rect key={`${key}-${i}`} x={x + 0.05} y={y + 0.05} width={0.9} height={0.9} fill={fill} />
  ));

function Galaxy() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    type Star = { x: number; y: number; s: number; a: number; tw: number; ph: number; vx: number; c: string };
    type Streak = { x: number; y: number; vx: number; vy: number; born: number } | null;

    let stars: Star[] = [];
    let streak: Streak = null;
    let nextStreak = 2.5;
    let raf = 0;
    let running = false;
    let w = 0;
    let h = 0;

    const COLORS = ["#ffffff", "#ffffff", "#ffffff", "#d9ff3d", "#a98bff", "#71f6ff"];
    const NEBULAE = [
      { x: 0.22, y: 0.3, c: "169,139,255" },
      { x: 0.55, y: 0.55, c: "31,83,255" },
      { x: 0.82, y: 0.35, c: "217,255,61" },
    ];

    const resize = () => {
      const rect = canvas.parentElement!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const n = Math.max(60, Math.min(160, Math.round((w * h) / 9000)));
      stars = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        s: Math.random() < 0.8 ? 1.5 : 2.5,
        a: 0.25 + Math.random() * 0.55,
        tw: 0.6 + Math.random() * 1.8,
        ph: Math.random() * Math.PI * 2,
        vx: 2 + Math.random() * 6,
        c: COLORS[Math.floor(Math.random() * COLORS.length)],
      }));
    };

    const frame = (t: number) => {
      ctx.clearRect(0, 0, w, h);

      // Nebula wash, drifting slowly.
      for (let i = 0; i < NEBULAE.length; i++) {
        const nb = NEBULAE[i];
        const nx = nb.x * w + Math.sin(t * 0.05 + i * 2.1) * 30;
        const ny = nb.y * h + Math.cos(t * 0.04 + i * 1.4) * 24;
        const r = Math.min(w, h) * 0.42;
        const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, r);
        g.addColorStop(0, `rgba(${nb.c},0.07)`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(nx - r, ny - r, r * 2, r * 2);
      }

      // Pixel stars, twinkling and drifting.
      for (const st of stars) {
        const x = (st.x + t * st.vx) % (w + 4);
        const alpha = st.a * (0.55 + 0.45 * Math.sin(t * st.tw + st.ph));
        ctx.globalAlpha = Math.max(alpha, 0.05);
        ctx.fillStyle = st.c;
        ctx.fillRect(x - 2, st.y, st.s, st.s);
      }
      ctx.globalAlpha = 1;

      // The occasional shooting star.
      if (!streak && t > nextStreak) {
        streak = {
          x: Math.random() * w * 0.7,
          y: Math.random() * h * 0.35,
          vx: 380 + Math.random() * 240,
          vy: 130 + Math.random() * 90,
          born: t,
        };
      }
      if (streak) {
        const age = t - streak.born;
        if (age > 0.8) {
          streak = null;
          nextStreak = t + 3.5 + Math.random() * 5;
        } else {
          const sx = streak.x + streak.vx * age;
          const sy = streak.y + streak.vy * age;
          const fade = 1 - age / 0.8;
          ctx.strokeStyle = `rgba(255,255,255,${0.7 * fade})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(sx - streak.vx * 0.06, sy - streak.vy * 0.06);
          ctx.lineTo(sx, sy);
          ctx.stroke();
        }
      }
    };

    const loop = () => {
      frame(performance.now() / 1000);
      raf = requestAnimationFrame(loop);
    };

    resize();
    if (reduced) {
      frame(1); // one calm, static sky
    }

    const io = new IntersectionObserver(([entry]) => {
      if (reduced) return;
      if (entry.isIntersecting && !running) {
        running = true;
        raf = requestAnimationFrame(loop);
      } else if (!entry.isIntersecting && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    });
    io.observe(canvas);

    const onResize = () => {
      resize();
      if (reduced) frame(1);
    };
    window.addEventListener("resize", onResize);

    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />;
}

export default function HeroBackdrop() {
  return (
    <div data-hero-backdrop aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
      <Galaxy />

      {/* Terminal: code shipping in real time */}
      <div className="absolute left-[3%] top-[15.5%] w-40 -rotate-6 opacity-70 md:left-[4%] md:top-[13%] md:w-60">
        <div className="hb-float rounded-lg border border-white/12 bg-[#101014]/80" style={{ "--dur": "7s" } as React.CSSProperties}>
          <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-[#ff4d1c]/80" />
            <span className="h-2 w-2 rounded-full bg-[#d9ff3d]/80" />
            <span className="h-2 w-2 rounded-full bg-[#5bf1a6]/80" />
            <span className="label ml-2 text-[8px] text-white/40">5cale.ts</span>
          </div>
          <div className="h-20 overflow-hidden px-3 py-2 md:h-40">
            <div className="hb-scroll" style={{ "--dur": "14s" } as React.CSSProperties}>
              {[0, 1].map((copy) => (
                <div key={copy}>
                  {CODE_LINES.map(([line, cls], i) => (
                    <p key={i} className={`whitespace-pre font-mono text-[8px] leading-relaxed md:text-[10px] ${cls}`}>
                      {line}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Social post: the new brand going live */}
      <div className="absolute right-[4%] top-[12%] hidden w-48 rotate-[5deg] opacity-70 md:block">
        <div className="hb-float overflow-hidden rounded-xl border border-white/12 bg-[#101014]/85" style={{ "--dur": "8.5s", "--delay": "-2s" } as React.CSSProperties}>
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#d9ff3d]">
              <LogoMark className="h-3.5 w-auto text-[#0b0b0b]" />
            </span>
            <div>
              <p className="text-[10px] font-medium text-white/85">@5cale</p>
              <p className="text-[8px] text-white/40">just now</p>
            </div>
          </div>
          <div className="relative mx-2 flex h-28 items-center justify-center rounded-md" style={{ background: "linear-gradient(135deg, #ff4d1c, #a98bff)" }}>
            <LogoMark className="h-12 w-auto text-white/90" />
            <span className="label absolute bottom-1.5 right-2 text-[7px] text-white/70">rebrand.png</span>
          </div>
          <div className="flex items-center gap-3 px-3 py-2 text-[9px] text-white/60">
            <span>♥ 5.2k</span>
            <span>↺ 512</span>
            <span className="ml-auto text-[#d9ff3d]/90">new drop ✦</span>
          </div>
        </div>
      </div>

      {/* Infographic: growth, charted */}
      <div className="absolute bottom-[15%] left-[6%] hidden w-44 rotate-[2.5deg] opacity-70 lg:block">
        <div className="hb-float rounded-lg border border-white/12 bg-[#101014]/80 p-3" style={{ "--dur": "9s", "--delay": "-4s" } as React.CSSProperties}>
          <p className="label text-[8px] text-white/45">Reach, five acts in</p>
          <div className="mt-2 flex h-16 items-end gap-1.5">
            {[22, 38, 54, 72, 100].map((v, i) => (
              <span
                key={i}
                className="hb-bar w-full rounded-sm bg-[#d9ff3d]/85"
                style={{ height: `${v}%`, animationDelay: `${i * 0.22}s` } as React.CSSProperties}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="font-pixel text-sm text-[#d9ff3d]">+512%</span>
            <svg viewBox="0 0 36 36" className="h-8 w-8 -rotate-90">
              <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3.5" />
              <circle cx="18" cy="18" r="14" fill="none" stroke="#5bf1a6" strokeWidth="3.5" strokeLinecap="round" pathLength={240} className="hb-draw" />
            </svg>
          </div>
        </div>
      </div>

      {/* Pixel rocket, flame flickering frame by frame */}
      <div className="absolute bottom-[16%] right-[7%] rotate-[10deg] opacity-80 md:bottom-[22%] md:right-[11%]">
        <div className="hb-float" style={{ "--dur": "6s", "--delay": "-1.2s" } as React.CSSProperties}>
          <svg viewBox="0 0 7 10" shapeRendering="crispEdges" className="h-14 w-auto md:h-16">
            {px(ROCKET_BODY, "rgba(244,241,234,0.85)", "b")}
            <rect x={3.05} y={2.05} width={0.9} height={0.9} fill="#71f6ff" />
            {px(ROCKET_FINS, "rgba(169,139,255,0.85)", "f")}
            <g className="hb-frame">{px(FLAME_A, "#d9ff3d", "fa")}</g>
            <g className="hb-frame-alt">{px(FLAME_B, "#ff4d1c", "fb")}</g>
          </svg>
        </div>
      </div>

      {/* Marker doodles, drawn and redrawn by hand */}
      <svg viewBox="0 0 60 60" className="absolute right-[24%] top-[16%] h-12 w-12 rotate-12 opacity-60 md:h-16 md:w-16" fill="none">
        <path
          d="M30 6 L34.5 22 51 22.5 38 33 42.5 50 30 40 17 50.5 21.5 33 9 22 25.5 22.5 Z"
          stroke="#d9ff3d"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={240}
          className="hb-draw"
        />
      </svg>
      <svg viewBox="0 0 60 50" className="absolute left-[26%] top-[9%] hidden h-14 w-16 -rotate-6 opacity-50 md:block" fill="none">
        <path
          d="M28 26 C 32 20, 40 22, 39 29 C 38 36, 27 36, 24 29 C 20 20, 30 12, 41 15 C 52 18, 54 32, 45 40"
          stroke="rgba(244,241,234,0.75)"
          strokeWidth="2"
          strokeLinecap="round"
          pathLength={240}
          className="hb-draw"
          style={{ animationDelay: "-2.5s" }}
        />
      </svg>
      <svg viewBox="0 0 80 50" className="absolute bottom-[9%] right-[3%] hidden h-12 w-20 opacity-55 lg:block" fill="none">
        <path
          d="M6 10 C 26 4, 52 10, 66 30 M66 30 L56 24 M66 30 L64 18"
          stroke="#71f6ff"
          strokeWidth="2.2"
          strokeLinecap="round"
          pathLength={240}
          className="hb-draw"
          style={{ animationDelay: "-4s" }}
        />
      </svg>
      <svg viewBox="0 0 90 20" className="absolute bottom-[30%] left-[9%] hidden h-5 w-24 -rotate-3 opacity-50 md:block" fill="none">
        <path
          d="M4 12 L16 6 L26 14 L38 5 L48 13 L60 6 L70 14 L84 7"
          stroke="rgba(169,139,255,0.8)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={240}
          className="hb-draw"
          style={{ animationDelay: "-1.5s" }}
        />
      </svg>
    </div>
  );
}
