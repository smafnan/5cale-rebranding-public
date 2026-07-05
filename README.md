# 5CALE® — Rebranding

The full 360° rebrand of [5cale.com](https://5cale.com), built from scratch around one idea:

> **5cale = Scale.** Every brand climbs five acts — SEED → BUILD → BRAND → GROW → SCALE.

## The system

- **Five acts, five worlds** — scrolling the home page repaints the entire site (background, ink, accent) per act.
- **The 3D "5"** — a chrome companion (React Three Fiber) that travels with you as you scroll: wireframes in BUILD, changes tint per act, disperses into particles in SCALE and reforms for the CTA.
- **Pencil cursor** — the pointer draws fading strokes in the current accent color (desktop only).
- **Hover walkthrough** — services open like an index as you sweep over them; deliverable tags drop and pile with a bounce.
- **Identity** — wordmark `5CALE` in expanded Archivo Black; mark = five ascending bars (staircase / equalizer / 5).

## Stack

Next.js (App Router, TS) · Tailwind v4 · GSAP + ScrollTrigger · Lenis · three.js + React Three Fiber + drei

## Develop

```bash
npm install
npm run dev    # http://localhost:3000
npm run build  # production build
```

## Before launch — placeholders to swap

- `CONTACT_EMAIL` in `src/lib/data.ts` (currently hello@5cale.com)
- `PROJECTS` in `src/lib/data.ts` — replace with real case studies
- Social links in `Footer.tsx` / `contact/page.tsx` (currently `#`)
- Contact form uses `mailto:` — wire to a form backend (Resend / Formspree / API route)

Accessibility: all signature motion respects `prefers-reduced-motion`; the 3D scene falls back to a calm rotating mark.
