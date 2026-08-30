"use client";

import { useEffect, useRef } from "react";
import { cursorStore } from "@/lib/cursor-store";

type Point = { x: number; y: number; t: number };

const LIFETIME = 1200; // ms before a stroke fully fades
const GAP = 90; // ms gap that counts as "pen lifted"

/**
 * MS-Paint-pencil cursor trail (dieleere reference): the pointer draws
 * strokes in the current act's accent color, which fade like pencil marks.
 * Disabled on touch devices and for reduced-motion users.
 */
export default function PencilCursor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let points: Point[] = [];
    let raf = 0;
    let dpr = 1;
    let lastX = NaN;
    let lastY = NaN;
    // CSS-pixel size of the canvas's own rendered box (not window.innerWidth/
    // innerHeight — those include the scrollbar gutter, which the canvas's
    // own 100%-width box excludes, so using window size here would leave a
    // few pixels of drift toward the right/bottom edge).
    let cssWidth = 0;
    let cssHeight = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      cssWidth = rect.width;
      cssHeight = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = cssWidth * dpr;
      canvas.height = cssHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    };

    const draw = () => {
      const now = performance.now();
      // Sample the cursor's eased position (same value InvertCursor's "5"
      // icon is rendered at that frame) rather than raw pointer events —
      // otherwise the line runs ahead of the icon it's meant to trail from
      // whenever the mouse moves fast.
      // Only on actual movement: sampling per frame regardless would push a
      // fresh point every ~16ms while the mouse sits still, which never
      // exceeds GAP and keeps re-feeding the LIFETIME filter, so the trail
      // would never clear — it would leave a dot parked under the cursor.
      if (cursorStore.ready && (cursorStore.x !== lastX || cursorStore.y !== lastY)) {
        lastX = cursorStore.x;
        lastY = cursorStore.y;
        points.push({ x: lastX, y: lastY, t: now });
        if (points.length > 400) points = points.slice(-400);
      }
      points = points.filter((p) => now - p.t < LIFETIME);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const accent =
        getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#d9ff3d";
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.25;

      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        if (b.t - a.t > GAP) continue; // pen lifted — don't connect
        ctx.globalAlpha = Math.max(0, 1 - (now - b.t) / LIFETIME) * 0.9;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      // w-full/h-full are load-bearing here, not decorative: <canvas> is a
      // replaced element, so "fixed inset-0" alone (which stretches a plain
      // div to the viewport) does NOT stretch it — it falls back to the
      // width/height attributes below (the DPR-scaled backing-store size).
      // Without an explicit CSS size, the canvas's on-screen box renders at
      // that backing resolution instead of the viewport size, scaling
      // (and offsetting) every drawn point by ~devicePixelRatio versus
      // where the cursor actually is.
      className="pointer-events-none fixed inset-0 z-[90] h-full w-full"
    />
  );
}
