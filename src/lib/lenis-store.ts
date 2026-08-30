import type Lenis from "lenis";

// Shared handle to the page's Lenis instance so components outside
// SmoothScroll (e.g. the fullscreen nav menu) can pause/resume it —
// mirrors scroll-store.ts's pattern of a plain mutable module export.
export const lenisStore: { instance: Lenis | null } = { instance: null };
