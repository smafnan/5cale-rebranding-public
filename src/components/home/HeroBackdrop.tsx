"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import LogoMark from "@/components/LogoMark";

/* Everything the studio makes, floating behind the title: running code,
   a social post going live, an infographic, marker doodles, pixel art,
   all drifting through a slow-moving pixel galaxy. Every asset is a
   door: cards and doodles link into the site, the galaxy itself fires
   shooting stars where you click.

   Lives inside the hero as a negative-z child: gap clicks in the section
   hit-test through to these links. The 3D five's hero waypoint (upper
   right) is kept clear of cards so the chrome mark flies unobstructed. */

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
    type Streak = { x: number; y: number; vx: number; vy: number; born: number };
    type Spark = { x: number; y: number; vx: number; vy: number; born: number; c: string };

    let stars: Star[] = [];
    let streak: Streak | null = null;
    let bursts: Streak[] = [];
    let sparks: Spark[] = [];
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

    const drawStreak = (s: Streak, t: number, life: number) => {
      const age = t - s.born;
      if (age > life) return false;
      const sx = s.x + s.vx * age;
      const sy = s.y + s.vy * age;
      const fade = 1 - age / life;
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * fade})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx - s.vx * 0.06, sy - s.vy * 0.06);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      return true;
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

      // The occasional ambient shooting star.
      if (!streak && t > nextStreak) {
        streak = {
          x: Math.random() * w * 0.7,
          y: Math.random() * h * 0.35,
          vx: 380 + Math.random() * 240,
          vy: 130 + Math.random() * 90,
          born: t,
        };
      }
      if (streak && !drawStreak(streak, t, 0.8)) {
        streak = null;
        nextStreak = t + 3.5 + Math.random() * 5;
      }

      // Click-made shooting stars and sparks.
      bursts = bursts.filter((b) => drawStreak(b, t, 0.9));
      sparks = sparks.filter((sp) => {
        const age = t - sp.born;
        if (age > 0.7) return false;
        ctx.globalAlpha = 1 - age / 0.7;
        ctx.fillStyle = sp.c;
        ctx.fillRect(sp.x + sp.vx * age, sp.y + sp.vy * age, 2.5, 2.5);
        return true;
      });
      ctx.globalAlpha = 1;
    };

    const loop = () => {
      frame(performance.now() / 1000);
      raf = requestAnimationFrame(loop);
    };

    // Tap the sky, get a meteor shower.
    const onDown = (e: PointerEvent) => {
      if (reduced) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const t = performance.now() / 1000;
      for (let i = 0; i < 3; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = 260 + Math.random() * 260;
        bursts.push({ x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, born: t });
      }
      for (let i = 0; i < 10; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = 40 + Math.random() * 140;
        sparks.push({
          x: cx,
          y: cy,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          born: t,
          c: COLORS[Math.floor(Math.random() * COLORS.length)],
        });
      }
    };
    canvas.addEventListener("pointerdown", onDown);

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
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-auto absolute inset-0 h-full w-full"
    />
  );
}

export default function HeroBackdrop() {
  return (
    <div
      data-hero-backdrop
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <Galaxy />

      {/* Terminal: code shipping in real time */}
      <Link
        href="/services"
        aria-label="Websites, apps and AI: explore the services"
        className="group pointer-events-auto absolute left-[3%] top-[15.5%] block w-44 -rotate-6 opacity-70 transition duration-300 hover:scale-[1.04] hover:opacity-100 md:left-[4%] md:top-[13%] md:w-72"
      >
        <div className="hb-float rounded-lg border border-white/12 bg-[#101014]/80" style={{ "--dur": "7s" } as React.CSSProperties}>
          <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-[#ff4d1c]/80" />
            <span className="h-2 w-2 rounded-full bg-[#d9ff3d]/80" />
            <span className="h-2 w-2 rounded-full bg-[#5bf1a6]/80" />
            <span className="label ml-2 text-[9px] text-white/40">5cale.ts</span>
          </div>
          <div className="h-24 overflow-hidden px-3 py-2 md:h-48">
            <div className="hb-scroll" style={{ "--dur": "14s" } as React.CSSProperties}>
              {[0, 1].map((copy) => (
                <div key={copy}>
                  {CODE_LINES.map(([line, cls], i) => (
                    <p key={i} className={`whitespace-pre font-mono text-[9px] leading-relaxed md:text-[11px] ${cls}`}>
                      {line}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Link>

      {/* Social post: the new brand going live */}
      <Link
        href="/work"
        aria-label="The rebrand going live: see the work"
        className="group pointer-events-auto absolute left-1/2 top-[6.5%] hidden w-60 -translate-x-1/2 rotate-[5deg] opacity-70 transition duration-300 hover:scale-[1.04] hover:opacity-100 md:block"
      >
        <div className="hb-float overflow-hidden rounded-xl border border-white/12 bg-[#101014]/85" style={{ "--dur": "8.5s", "--delay": "-2s" } as React.CSSProperties}>
          <div className="flex items-center gap-2 px-3 py-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#d9ff3d]">
              <LogoMark className="h-4 w-auto text-[#0b0b0b]" />
            </span>
            <div>
              <p className="text-[11px] font-medium text-white/85">@5cale</p>
              <p className="text-[9px] text-white/40">just now</p>
            </div>
          </div>
          <div className="relative mx-2.5 flex h-36 items-center justify-center rounded-md" style={{ background: "linear-gradient(135deg, #ff4d1c, #a98bff)" }}>
            <LogoMark className="h-14 w-auto text-white/90" />
            <span className="label absolute bottom-2 right-2.5 text-[8px] text-white/70">rebrand.png</span>
          </div>
          <div className="flex items-center gap-3 px-3 py-2.5 text-[10px] text-white/60">
            <span>♥ 5.2k</span>
            <span>↺ 512</span>
            <span className="ml-auto text-[#d9ff3d]/90">new drop ✦</span>
          </div>
        </div>
      </Link>

      {/* Infographic: growth, charted */}
      <Link
        href="/about"
        aria-label="The numbers behind the studio: about 5cale"
        className="group pointer-events-auto absolute bottom-[32%] left-[6%] hidden w-56 rotate-[2.5deg] opacity-70 transition duration-300 hover:scale-[1.04] hover:opacity-100 lg:block"
      >
        <div className="hb-float rounded-lg border border-white/12 bg-[#101014]/80 p-4" style={{ "--dur": "9s", "--delay": "-4s" } as React.CSSProperties}>
          <p className="label text-[9px] text-white/45">Reach, five acts in</p>
          <div className="mt-2.5 flex h-20 items-end gap-2">
            {[22, 38, 54, 72, 100].map((v, i) => (
              <span
                key={i}
                className="hb-bar w-full rounded-sm bg-[#d9ff3d]/85"
                style={{ height: `${v}%`, animationDelay: `${i * 0.22}s` } as React.CSSProperties}
              />
            ))}
          </div>
          <div className="mt-2.5 flex items-center justify-between">
            <span className="font-pixel text-lg text-[#d9ff3d]">+512%</span>
            <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90">
              <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3.5" />
              <circle cx="18" cy="18" r="14" fill="none" stroke="#5bf1a6" strokeWidth="3.5" strokeLinecap="round" pathLength={240} className="hb-draw" />
            </svg>
          </div>
        </div>
      </Link>

      {/* Pixel rocket, flame flickering frame by frame */}
      <Link
        href="/contact"
        aria-label="Ready for launch: start a project"
        className="group pointer-events-auto absolute bottom-[16%] right-[7%] block rotate-[10deg] opacity-80 transition duration-300 hover:scale-110 hover:opacity-100 md:bottom-[31%] md:right-[13%]"
      >
        <div className="hb-float" style={{ "--dur": "6s", "--delay": "-1.2s" } as React.CSSProperties}>
          <svg viewBox="0 0 7 10" shapeRendering="crispEdges" className="h-16 w-auto md:h-24">
            {px(ROCKET_BODY, "rgba(244,241,234,0.85)", "b")}
            <rect x={3.05} y={2.05} width={0.9} height={0.9} fill="#71f6ff" />
            {px(ROCKET_FINS, "rgba(169,139,255,0.85)", "f")}
            <g className="hb-frame">{px(FLAME_A, "#d9ff3d", "fa")}</g>
            <g className="hb-frame-alt">{px(FLAME_B, "#ff4d1c", "fb")}</g>
          </svg>
        </div>
      </Link>

      {/* Marker doodles, drawn and redrawn by hand */}
      <Link href="/work" aria-label="See the work" className="pointer-events-auto absolute right-[8%] top-[22%] block rotate-12 opacity-60 transition duration-300 hover:scale-110 hover:opacity-100 md:left-[21%] md:right-auto md:top-[24%]">
        <svg viewBox="0 0 60 60" className="h-12 w-12 md:h-16 md:w-16" fill="none">
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
      </Link>
      <Link href="/about" aria-label="About the studio" className="pointer-events-auto absolute left-[26%] top-[9%] hidden -rotate-6 opacity-50 transition duration-300 hover:scale-110 hover:opacity-100 md:block">
        <svg viewBox="0 0 60 50" className="h-14 w-16" fill="none">
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
      </Link>
      <Link href="/contact" aria-label="Get in touch" className="pointer-events-auto absolute bottom-[9%] right-[3%] hidden opacity-55 transition duration-300 hover:scale-110 hover:opacity-100 lg:block">
        <svg viewBox="0 0 80 50" className="h-12 w-20" fill="none">
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
      </Link>
      <Link href="/services" aria-label="Explore the services" className="pointer-events-auto absolute bottom-[33%] left-[35%] hidden -rotate-3 opacity-50 transition duration-300 hover:scale-110 hover:opacity-100 md:block">
        <svg viewBox="0 0 90 20" className="h-5 w-24" fill="none">
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
      </Link>
      <Link href="/services" aria-label="Fast builds: the services" className="pointer-events-auto absolute bottom-[33%] right-[28%] hidden rotate-6 opacity-55 transition duration-300 hover:scale-110 hover:opacity-100 md:block">
        <svg viewBox="0 0 36 48" className="h-11 w-9" fill="none">
          <path
            d="M22 4 L10 26 L19 26 L14 44 L30 20 L20 20 L26 4 Z"
            stroke="#ff4d1c"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={240}
            className="hb-draw"
            style={{ animationDelay: "-3s" }}
          />
        </svg>
      </Link>
      <Link href="/about" aria-label="The friendly humans behind 5cale" className="pointer-events-auto absolute bottom-[31%] right-[22%] block -rotate-6 opacity-55 transition duration-300 hover:scale-110 hover:opacity-100">
        <svg viewBox="0 0 48 48" className="h-10 w-10 md:h-12 md:w-12" fill="none" stroke="rgba(244,241,234,0.7)" strokeWidth="2" strokeLinecap="round">
          <path
            d="M24 6 C 34 6 42 14 41 24 C 40 35 32 42 22 41 C 12 40 6 32 7 22 C 8 12 15 6 24 6"
            pathLength={240}
            className="hb-draw"
            style={{ animationDelay: "-5s" }}
          />
          <path d="M18 18 L18 23" pathLength={240} className="hb-draw" style={{ animationDelay: "-5s" }} />
          <path d="M30 17 L30 22" pathLength={240} className="hb-draw" style={{ animationDelay: "-5s" }} />
          <path d="M15 29 C 19 35 29 35 33 28" pathLength={240} className="hb-draw" style={{ animationDelay: "-5s" }} />
        </svg>
      </Link>
      <Link href="/contact" aria-label="Projects we will love" className="pointer-events-auto absolute bottom-[7%] left-[40%] hidden rotate-3 opacity-55 transition duration-300 hover:scale-110 hover:opacity-100 md:block">
        <svg viewBox="0 0 40 40" className="h-9 w-9" fill="none">
          <path
            d="M20 34 C 6 24 4 12 12 8 C 17 5 20 9 20 12 C 20 9 23 5 28 8 C 36 12 34 24 20 34"
            stroke="#ff4d1c"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={240}
            className="hb-draw"
            style={{ animationDelay: "-1s" }}
          />
        </svg>
      </Link>
      <Link href="/work" aria-label="Highlights from the work" className="pointer-events-auto absolute left-[33%] top-[5%] hidden rotate-12 opacity-55 transition duration-300 hover:scale-110 hover:opacity-100 lg:block">
        <svg viewBox="0 0 40 40" className="h-10 w-10" fill="none" stroke="#5bf1a6" strokeWidth="2.2" strokeLinecap="round">
          <path d="M20 4 L20 14 M20 26 L20 36 M4 20 L14 20 M26 20 L36 20 M9 9 L16 16 M24 24 L31 31 M31 9 L24 16 M16 24 L9 31" pathLength={240} className="hb-draw" style={{ animationDelay: "-6s" }} />
        </svg>
      </Link>
    </div>
  );
}
