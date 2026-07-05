"use client";

import { useEffect, useRef } from "react";

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

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    };

    const onMove = (e: PointerEvent) => {
      points.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      if (points.length > 400) points = points.slice(-400);
    };

    const draw = () => {
      const now = performance.now();
      points = points.filter((p) => now - p.t < LIFETIME);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

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
    window.addEventListener("pointermove", onMove);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[90]"
    />
  );
}
