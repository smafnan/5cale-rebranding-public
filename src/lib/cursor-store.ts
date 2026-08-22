// Shared handle to the custom cursor's live, eased screen position.
// InvertCursor renders the "5" mark with a 0.15s GSAP lag behind the raw
// pointer for a smooth follow feel; PencilCursor needs to draw its trail
// from that exact same eased position (not the raw pointer event), or the
// line visibly leads the icon during fast mouse movement.
export const cursorStore: { x: number; y: number; ready: boolean } = {
  x: 0,
  y: 0,
  ready: false,
};
