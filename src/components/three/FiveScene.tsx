"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";

// Three.js must never render on the server.
const FiveCanvas = dynamic(() => import("./FiveCanvas"), { ssr: false });

const emptySubscribe = () => () => {};

/**
 * Fixed, non-interactive 3D layer.
 * Portaled to <body>: the route template animates `transform`, which would
 * otherwise become the containing block for position:fixed and stretch the
 * canvas to the full document height.
 */
export default function FiveScene() {
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  if (!mounted) return null;

  return createPortal(
    // Negative z: behind all page content (titles stay readable), but still
    // above the body background thanks to root-stacking-context paint order.
    <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden>
      <FiveCanvas />
    </div>,
    document.body
  );
}
