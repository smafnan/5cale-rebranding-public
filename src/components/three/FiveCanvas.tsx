"use client";

import { Canvas } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import FiveMark from "./FiveMark";

export default function FiveCanvas() {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 11], fov: 32 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
    >
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 6, 6]} intensity={1.1} />

      <FiveMark />

      {/* Procedural studio lighting — chrome reflections with no network fetch */}
      <Environment resolution={256}>
        <Lightformer intensity={2.8} position={[0, 5, -2]} rotation-x={Math.PI / 2} scale={[10, 5, 1]} />
        <Lightformer intensity={1.4} position={[-5, 1, 3]} rotation-y={Math.PI / 2} scale={[6, 2.5, 1]} />
        <Lightformer intensity={1.8} position={[5, -1, 3]} rotation-y={-Math.PI / 2} scale={[6, 2.5, 1]} />
        <Lightformer intensity={0.8} color="#d9ff3d" position={[0, -4, 2]} rotation-x={-Math.PI / 2} scale={[8, 3, 1]} />
      </Environment>
    </Canvas>
  );
}
