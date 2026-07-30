import { useEffect, useRef } from 'react';
import { ShaderIdenticonRenderer } from '../ui/shader-identicon.ts';

export interface ShaderIdenticonProps {
  seed: string;
  size?: number;
  mode?: '2d-sdf' | '3d-polyhedron';
  audioPeak?: number;
  multiBand?: {
    bass?: number;
    mid?: number;
    treble?: number;
  };
  className?: string;
  ariaLabel?: string;
}

export function ShaderIdenticon({
  seed,
  size = 48,
  mode = '2d-sdf',
  audioPeak = 0,
  multiBand,
  className = '',
  ariaLabel,
}: ShaderIdenticonProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<ShaderIdenticonRenderer | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(performance.now());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new ShaderIdenticonRenderer(canvas);
    rendererRef.current = renderer;

    const animate = (now: number) => {
      const timeSec = (now - startTimeRef.current) / 1000;
      renderer.render({
        seed,
        mode,
        audioPeak,
        multiBand,
        timeSec,
      });
      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
      renderer.destroy();
    };
  }, [seed, mode, audioPeak, multiBand]);

  return (
    <span
      className={`stims-shader-identicon ${className}`}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        position: 'relative',
        transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
      aria-label={ariaLabel ?? `Shader SDF identicon (${mode}) for ${seed}`}
      role="img"
    >
      <canvas
        ref={canvasRef}
        width={size * window.devicePixelRatio}
        height={size * window.devicePixelRatio}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '6px',
        }}
      />
    </span>
  );
}
