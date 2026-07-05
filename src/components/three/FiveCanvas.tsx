"use client";

import { Canvas } from "@react-three/fiber";
import FiveMark from "./FiveMark";

export default function FiveCanvas() {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 11], fov: 32 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
    >
      {/* The mark uses a generated matcap — studio chrome without any
          environment-map dependency, identical on every GPU. */}
      <FiveMark />
    </Canvas>
  );
}
