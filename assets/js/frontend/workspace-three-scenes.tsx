import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import type { Group, Mesh } from 'three';
import { AdditiveBlending, Color, DoubleSide, Vector3 } from 'three';

export type PresetArtworkTone =
  | 'bright'
  | 'geometry'
  | 'space'
  | 'moody'
  | 'psychedelic'
  | 'classic'
  | 'instant';

const STAGE_ORBS = [
  {
    key: 'ember-left',
    color: '#f47a54',
    position: [-2.5, 1.6, -1.2] as [number, number, number],
    scale: 0.72,
    speed: 0.28,
  },
  {
    key: 'sky-right',
    color: '#77c9ff',
    position: [2.1, 1.1, -0.8] as [number, number, number],
    scale: 0.58,
    speed: 0.34,
  },
  {
    key: 'mint-floor',
    color: '#7de0a2',
    position: [1.8, -1.7, -1.5] as [number, number, number],
    scale: 0.64,
    speed: 0.22,
  },
  {
    key: 'gold-pocket',
    color: '#f5d06a',
    position: [-1.4, -1.2, -0.6] as [number, number, number],
    scale: 0.44,
    speed: 0.4,
  },
  {
    key: 'violet-core',
    color: '#a6a0ff',
    position: [0.1, 0.4, -2.2] as [number, number, number],
    scale: 0.92,
    speed: 0.18,
  },
  {
    key: 'rose-cap',
    color: '#ff9ec6',
    position: [-0.5, 2.2, -2.4] as [number, number, number],
    scale: 0.38,
    speed: 0.42,
  },
];

const ARTWORK_NODES = [
  {
    key: 'northwest',
    position: [-1.25, 0.7, -0.6] as [number, number, number],
    scale: 0.34,
    speed: 0.6,
  },
  {
    key: 'northeast',
    position: [1.05, 0.85, 0.05] as [number, number, number],
    scale: 0.22,
    speed: 0.92,
  },
  {
    key: 'center',
    position: [0.15, -0.15, 0.28] as [number, number, number],
    scale: 0.58,
    speed: 0.42,
  },
  {
    key: 'southwest',
    position: [-0.9, -0.82, 0.18] as [number, number, number],
    scale: 0.18,
    speed: 1.12,
  },
  {
    key: 'southeast',
    position: [1.28, -0.62, -0.12] as [number, number, number],
    scale: 0.26,
    speed: 0.78,
  },
];

const PRESET_TONE_COLORS: Record<
  PresetArtworkTone,
  {
    background: string;
    accent: string;
    accentSoft: string;
    glow: string;
    ring: string;
  }
> = {
  bright: {
    background: '#122248',
    accent: '#ffd784',
    accentSoft: '#ff9c72',
    glow: '#fff2bf',
    ring: '#77c9ff',
  },
  geometry: {
    background: '#09182f',
    accent: '#77c9ff',
    accentSoft: '#7de0a2',
    glow: '#c7ebff',
    ring: '#f47a54',
  },
  space: {
    background: '#091233',
    accent: '#7cc7ff',
    accentSoft: '#9f8eff',
    glow: '#e8f6ff',
    ring: '#7de0a2',
  },
  moody: {
    background: '#1b0d18',
    accent: '#f47a54',
    accentSoft: '#ffb18a',
    glow: '#ffd0bd',
    ring: '#77c9ff',
  },
  psychedelic: {
    background: '#1c123c',
    accent: '#ff8a65',
    accentSoft: '#77c9ff',
    glow: '#ffddf5',
    ring: '#a7ffdd',
  },
  classic: {
    background: '#0b2027',
    accent: '#7de0a2',
    accentSoft: '#77c9ff',
    glow: '#dfffe9',
    ring: '#f5d06a',
  },
  instant: {
    background: '#0d1830',
    accent: '#77c9ff',
    accentSoft: '#f47a54',
    glow: '#edf7ff',
    ring: '#7de0a2',
  },
};

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      setPrefersReducedMotion(mediaQuery.matches);
    };

    update();
    mediaQuery.addEventListener('change', update);
    return () => {
      mediaQuery.removeEventListener('change', update);
    };
  }, []);

  return prefersReducedMotion;
}

function ArtworkCluster({
  tone,
  compact = false,
}: {
  tone: PresetArtworkTone;
  compact?: boolean;
}) {
  const palette = PRESET_TONE_COLORS[tone];
  const groupRef = useRef<Group>(null);
  const ringRef = useRef<Mesh>(null);
  const glowRef = useRef<Mesh>(null);

  useFrame((state) => {
    const elapsed = state.clock.elapsedTime;

    if (groupRef.current) {
      groupRef.current.rotation.z = elapsed * (compact ? 0.08 : 0.14);
      groupRef.current.rotation.y = elapsed * (compact ? 0.1 : 0.16);
    }

    if (ringRef.current) {
      ringRef.current.rotation.z = elapsed * -0.22;
      ringRef.current.rotation.x = Math.sin(elapsed * 0.4) * 0.18;
      const scale = compact ? 0.96 : 1;
      ringRef.current.scale.setScalar(scale + Math.sin(elapsed * 0.7) * 0.04);
    }

    if (glowRef.current) {
      glowRef.current.rotation.z = elapsed * 0.12;
      glowRef.current.position.z = -0.4 + Math.sin(elapsed * 0.6) * 0.08;
    }
  });

  return (
    <>
      <ambientLight intensity={0.8} />
      <pointLight
        color={palette.accent}
        intensity={2.2}
        position={[1.4, 1.8, 3.2]}
      />
      <pointLight
        color={palette.accentSoft}
        intensity={1.9}
        position={[-1.8, -1.4, 2.8]}
      />
      <mesh ref={glowRef} position={[0, 0, -0.4]}>
        <planeGeometry args={[4.6, 3.1]} />
        <meshBasicMaterial
          color={palette.background}
          transparent
          opacity={compact ? 0.56 : 0.72}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh ref={ringRef} rotation={[0.8, 0.2, 0]}>
        <torusGeometry args={[1.16, compact ? 0.05 : 0.07, 16, 120]} />
        <meshBasicMaterial
          color={palette.ring}
          transparent
          opacity={compact ? 0.48 : 0.68}
        />
      </mesh>
      <group ref={groupRef}>
        {ARTWORK_NODES.map((node, index) => {
          const accentColor =
            index % 2 === 0 ? palette.accent : palette.accentSoft;
          return (
            <ArtworkNode
              key={`${tone}-${node.key}`}
              accentColor={accentColor}
              glowColor={palette.glow}
              compact={compact}
              index={index}
              position={node.position}
              scale={node.scale}
              speed={node.speed}
            />
          );
        })}
      </group>
    </>
  );
}

function ArtworkNode({
  accentColor,
  compact,
  glowColor,
  index,
  position,
  scale,
  speed,
}: {
  accentColor: string;
  compact: boolean;
  glowColor: string;
  index: number;
  position: [number, number, number];
  scale: number;
  speed: number;
}) {
  const meshRef = useRef<Mesh>(null);
  const orbitRef = useRef<Mesh>(null);
  const origin = new Vector3(...position);

  useFrame((state) => {
    const elapsed = state.clock.elapsedTime * speed;
    if (meshRef.current) {
      meshRef.current.position.set(
        origin.x + Math.sin(elapsed + index) * 0.12,
        origin.y + Math.cos(elapsed * 0.8 + index) * 0.09,
        origin.z + Math.sin(elapsed * 1.1) * 0.15,
      );
      meshRef.current.rotation.x = elapsed * 0.8;
      meshRef.current.rotation.y = elapsed * 1.1;
    }

    if (orbitRef.current) {
      orbitRef.current.position.copy(meshRef.current?.position ?? origin);
      orbitRef.current.rotation.z = elapsed * -0.9;
    }
  });

  return (
    <>
      <mesh
        ref={meshRef}
        position={position}
        scale={compact ? scale * 0.82 : scale}
      >
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial
          color={accentColor}
          emissive={new Color(accentColor).multiplyScalar(0.4)}
          emissiveIntensity={1}
          roughness={0.32}
          metalness={0.22}
        />
      </mesh>
      <mesh
        ref={orbitRef}
        position={position}
        scale={compact ? scale * 1.4 : scale * 1.7}
      >
        <torusGeometry args={[1, compact ? 0.04 : 0.05, 12, 48]} />
        <meshBasicMaterial color={glowColor} transparent opacity={0.34} />
      </mesh>
    </>
  );
}

function StageAmbientScene({ liveMode }: { liveMode: boolean }) {
  const groupRef = useRef<Group>(null);
  const planeRef = useRef<Mesh>(null);
  const haloRef = useRef<Mesh>(null);

  useFrame((state) => {
    const elapsed = state.clock.elapsedTime;

    if (groupRef.current) {
      groupRef.current.rotation.z = elapsed * 0.06;
      groupRef.current.rotation.y = elapsed * 0.08;
      groupRef.current.position.x = Math.sin(elapsed * 0.12) * 0.16;
    }

    if (planeRef.current) {
      planeRef.current.rotation.z = Math.sin(elapsed * 0.14) * 0.08;
    }

    if (haloRef.current) {
      haloRef.current.rotation.z = elapsed * (liveMode ? 0.12 : 0.08);
      const scale = liveMode ? 1.02 : 0.96;
      haloRef.current.scale.setScalar(scale + Math.sin(elapsed * 0.4) * 0.04);
    }
  });

  return (
    <>
      <ambientLight intensity={0.72} />
      <pointLight color="#77c9ff" intensity={2.3} position={[2.8, 2.4, 4.2]} />
      <pointLight color="#f47a54" intensity={1.8} position={[-3, 1.2, 3.8]} />
      <pointLight color="#7de0a2" intensity={1.5} position={[1.6, -2.8, 2.6]} />

      <mesh ref={planeRef} position={[0, 0, -2.5]} rotation={[0, 0, 0.08]}>
        <planeGeometry args={[14, 10]} />
        <meshBasicMaterial
          color={liveMode ? '#08131f' : '#09101d'}
          transparent
          opacity={liveMode ? 0.48 : 0.58}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      <mesh
        ref={haloRef}
        position={[0.8, -0.2, -1.4]}
        rotation={[0.84, 0.24, 0]}
      >
        <torusGeometry args={[2.9, 0.1, 16, 180]} />
        <meshBasicMaterial color="#77c9ff" transparent opacity={0.24} />
      </mesh>

      <group ref={groupRef}>
        {STAGE_ORBS.map((orb, index) => {
          const { key, ...orbConfig } = orb;
          return (
            <StageOrb
              key={key}
              index={index}
              liveMode={liveMode}
              {...orbConfig}
            />
          );
        })}
      </group>
    </>
  );
}

function StageOrb({
  color,
  index,
  liveMode,
  position,
  scale,
  speed,
}: {
  color: string;
  index: number;
  liveMode: boolean;
  position: [number, number, number];
  scale: number;
  speed: number;
}) {
  const meshRef = useRef<Mesh>(null);
  const ringRef = useRef<Mesh>(null);
  const origin = new Vector3(
    position[0] ?? 0,
    position[1] ?? 0,
    position[2] ?? 0,
  );

  useFrame((state) => {
    const elapsed = state.clock.elapsedTime * speed;

    if (meshRef.current) {
      meshRef.current.position.set(
        origin.x + Math.sin(elapsed + index) * 0.28,
        origin.y + Math.cos(elapsed * 0.7 + index) * 0.22,
        origin.z + Math.sin(elapsed * 0.5 + index) * 0.18,
      );
      meshRef.current.rotation.x = elapsed * 0.5;
      meshRef.current.rotation.y = elapsed * 0.85;
    }

    if (ringRef.current) {
      ringRef.current.position.copy(meshRef.current?.position ?? origin);
      ringRef.current.rotation.z = elapsed * -0.7;
    }
  });

  return (
    <>
      <mesh ref={meshRef} position={position} scale={scale}>
        <icosahedronGeometry args={[1, liveMode ? 1 : 0]} />
        <meshStandardMaterial
          color={color}
          emissive={new Color(color).multiplyScalar(0.46)}
          emissiveIntensity={1}
          roughness={0.28}
          metalness={0.18}
          transparent
          opacity={liveMode ? 0.9 : 0.82}
        />
      </mesh>
      <mesh ref={ringRef} position={position} scale={scale * 1.45}>
        <torusGeometry args={[1, 0.04, 12, 72]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={liveMode ? 0.3 : 0.22}
          side={DoubleSide}
        />
      </mesh>
    </>
  );
}

export function PresetArtworkBackdrop({
  compact = false,
  tone,
}: {
  compact?: boolean;
  tone: PresetArtworkTone;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <Canvas
      camera={{ fov: 36, position: [0, 0, 4.8] }}
      dpr={[1, 1.4]}
      frameloop={prefersReducedMotion ? 'demand' : 'always'}
      gl={{
        alpha: true,
        antialias: false,
        powerPreference: 'low-power',
      }}
    >
      <ArtworkCluster compact={compact} tone={tone} />
    </Canvas>
  );
}

export function StageAmbientBackdrop({ liveMode }: { liveMode: boolean }) {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <Canvas
      camera={{ fov: 42, position: [0, 0, 8.2] }}
      dpr={[1, 1.5]}
      frameloop={prefersReducedMotion ? 'demand' : 'always'}
      gl={{
        alpha: true,
        antialias: false,
        powerPreference: liveMode ? 'high-performance' : 'default',
      }}
    >
      <StageAmbientScene liveMode={liveMode} />
    </Canvas>
  );
}
