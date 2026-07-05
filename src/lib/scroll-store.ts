// Shared mutable scroll state — written by ThemeController's ScrollTriggers,
// read every frame by the 3D companion (useFrame) without causing React renders.

export type ScrollStore = {
  /** 0..1 progress through the whole page */
  progress: number;
  /** current act index: 0 = hero/base, 1..5 = acts, 6 = outro */
  act: number;
  /** scroll velocity (px/ms-ish, smoothed by GSAP) */
  velocity: number;
  /** [start, end] page-progress range of each act section, filled on refresh */
  ranges: Array<[number, number]>;
};

export const scrollStore: ScrollStore = {
  progress: 0,
  act: 0,
  velocity: 0,
  ranges: [],
};
