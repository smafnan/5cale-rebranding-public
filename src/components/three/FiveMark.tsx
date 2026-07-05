"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { scrollStore } from "@/lib/scroll-store";
import { THEMES } from "@/lib/data";

const ACT_KEYS = ["base", "seed", "build", "brand", "grow", "scale", "base"];
const WHITE = new THREE.Color("#ffffff");

// Waypoints for the journey across the page (everswap-style companion).
const STOPS = [0, 0.16, 0.34, 0.52, 0.7, 0.88, 1];
const PX = [1.9, -2.1, 2.1, 0.2, -2.3, 0, 0];
const PY = [-0.2, 0.1, -0.1, 0.15, 0, 0.1, -0.1];
const PS = [1, 0.8, 0.95, 1.28, 0.68, 1.05, 0.92];

function track(p: number, vals: number[]) {
  let i = 0;
  while (i < STOPS.length - 2 && p > STOPS[i + 1]) i++;
  const raw = (p - STOPS[i]) / (STOPS[i + 1] - STOPS[i]);
  const t = Math.min(Math.max(raw, 0), 1);
  const e = t * t * (3 - 2 * t); // smoothstep
  return vals[i] + (vals[i + 1] - vals[i]) * e;
}

/** The brand glyph: a squared-off "5" drawn as a Shape — no font file needed. */
function makeFiveGeometry() {
  const pts: [number, number][] = [
    [0, 14], [10, 14], [10, 11], [3, 11], [3, 8.5], [10, 8.5],
    [10, 0], [0, 0], [0, 3], [7, 3], [7, 5.5], [0, 5.5],
  ];
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0] - 5, pts[0][1] - 7);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0] - 5, pts[i][1] - 7);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 2.6,
    bevelEnabled: true,
    bevelThickness: 0.35,
    bevelSize: 0.28,
    bevelSegments: 4,
    curveSegments: 3,
  });
  geo.center();
  geo.scale(0.22, 0.22, 0.22);
  return geo;
}

export default function FiveMark() {
  const group = useRef<THREE.Group>(null);
  const solid = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshPhysicalMaterial>(null);
  const wireMat = useRef<THREE.MeshBasicMaterial>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const pointsMat = useRef<THREE.PointsMaterial>(null);
  const explodeRef = useRef(0);
  const { size } = useThree();

  const reduced = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  // Geometry + a scattered "exploded" target for every vertex (emergence-style).
  // Seeded PRNG keeps the scatter deterministic across renders (seed = 5, naturally).
  const { geo, base, scatter } = useMemo(() => {
    const g = makeFiveGeometry();
    const src = g.attributes.position.array as Float32Array;
    const b = new Float32Array(src);
    const s = new Float32Array(src.length);
    let seed = 5;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < src.length / 3; i++) {
      const r = 3.5 + rand() * 5.5;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      s[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      s[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      s[i * 3 + 2] = r * Math.cos(phi) * 0.6;
    }
    return { geo: g, base: b, scatter: s };
  }, []);

  const particleGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(base), 3));
    return g;
  }, [base]);

  const tintTarget = useMemo(() => new THREE.Color("#ffffff"), []);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;

    const t = state.clock.elapsedTime;
    const p = scrollStore.progress;
    const mobile = size.width < 768;

    if (reduced) {
      // Accessibility: a calm, slowly-turning mark instead of the full journey.
      g.position.set(mobile ? 0 : 1.9, -0.2, 0);
      g.rotation.y += delta * 0.25;
      return;
    }

    // — Journey path —
    const fx = track(p, PX) * (mobile ? 0.3 : 1);
    const fy = track(p, PY) + Math.sin(t * 0.8) * 0.1;
    const fs = track(p, PS) * (mobile ? 0.6 : 1);

    g.position.x = THREE.MathUtils.damp(g.position.x, fx, 4, delta);
    g.position.y = THREE.MathUtils.damp(g.position.y, fy, 4, delta);
    g.scale.setScalar(THREE.MathUtils.damp(g.scale.x, fs, 4, delta));

    g.rotation.y = p * Math.PI * 5 + t * 0.14;
    g.rotation.x = Math.sin(p * Math.PI * 2) * 0.22;
    g.rotation.z = THREE.MathUtils.damp(
      g.rotation.z,
      THREE.MathUtils.clamp(-scrollStore.velocity, -0.35, 0.35),
      3,
      delta
    );

    // — Act-based chrome tint —
    const act = Math.min(Math.max(scrollStore.act, 0), 6);
    const accent = THEMES[ACT_KEYS[act]].accent;
    tintTarget.set(accent).lerp(WHITE, act === 0 || act === 6 ? 1 : 0.45);
    if (mat.current) mat.current.color.lerp(tintTarget, 1 - Math.exp(-3 * delta));

    // — BUILD act: blueprint wireframe overlay —
    if (wireMat.current) {
      const target = act === 2 ? 0.55 : 0;
      wireMat.current.opacity = THREE.MathUtils.damp(wireMat.current.opacity, target, 5, delta);
      wireMat.current.color.set(accent);
    }

    // — SCALE act: disperse into particles, then reform (emergence-style) —
    let explode = 0;
    const range = scrollStore.ranges[4];
    if (range && p >= range[0]) {
      const local = (p - range[0]) / Math.max(range[1] - range[0], 0.0001);
      explode = Math.sin(THREE.MathUtils.clamp(local, 0, 1) * Math.PI);
    }
    explodeRef.current = THREE.MathUtils.damp(explodeRef.current, explode, 5, delta);
    const ex = explodeRef.current;

    if (mat.current) mat.current.opacity = 1 - ex * 0.92;
    if (solid.current) solid.current.visible = ex < 0.98;

    if (pointsMat.current) {
      pointsMat.current.opacity = ex;
      pointsMat.current.color.set(accent);
    }
    if (pointsRef.current) {
      pointsRef.current.visible = ex > 0.02;
      if (ex > 0.001) {
        const attr = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
        const arr = attr.array as Float32Array;
        for (let i = 0; i < arr.length; i++) {
          arr[i] = base[i] + (scatter[i] - base[i]) * ex;
        }
        attr.needsUpdate = true;
      }
    }
  });

  return (
    <group ref={group} position={[1.9, -0.2, 0]}>
      <mesh ref={solid} geometry={geo}>
        <meshPhysicalMaterial
          ref={mat}
          metalness={1}
          roughness={0.16}
          clearcoat={0.6}
          clearcoatRoughness={0.25}
          envMapIntensity={1.25}
          transparent
        />
      </mesh>
      <mesh geometry={geo} scale={1.002}>
        <meshBasicMaterial ref={wireMat} wireframe transparent opacity={0} />
      </mesh>
      <points ref={pointsRef} geometry={particleGeo} visible={false}>
        <pointsMaterial
          ref={pointsMat}
          size={0.045}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          color="#cbb7ff"
        />
      </points>
    </group>
  );
}
