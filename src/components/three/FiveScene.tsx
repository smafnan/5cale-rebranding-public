"use client";

import dynamic from "next/dynamic";

// Three.js must never render on the server.
const FiveCanvas = dynamic(() => import("./FiveCanvas"), { ssr: false });

/** Fixed, non-interactive 3D layer that rides above backgrounds, below content. */
export default function FiveScene() {
  return (
    <div className="pointer-events-none fixed inset-0 z-10" aria-hidden>
      <FiveCanvas />
    </div>
  );
}
