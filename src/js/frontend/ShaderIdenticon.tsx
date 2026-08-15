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
  const startTimeRef = useRef(performance.now());
  const visibleRef = useRef(false);
  const documentVisibleRef = useRef(!document.hidden);
  const reducedMotionRef = useRef(false);
  const smallIconRef = useRef(size <= 32);
  const lastAnimatedRenderRef = useRef<number | null>(null);
  const renderStateRef = useRef({
    seed,
    mode,
    audioPeak,
    bass: multiBand?.bass,
    mid: multiBand?.mid,
    treble: multiBand?.treble,
  });

  renderStateRef.current = {
    seed,
    mode,
    audioPeak,
    bass: multiBand?.bass,
    mid: multiBand?.mid,
    treble: multiBand?.treble,
  };
  smallIconRef.current = size <= 32;

  const controlsRef = useRef({
    render: (_now: number) => {},
    reconcile: () => {},
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new ShaderIdenticonRenderer(canvas);
    rendererRef.current = renderer;
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = motionQuery?.matches ?? false;

    const render = (now: number) => {
      const state = renderStateRef.current;
      renderer.render({
        seed: state.seed,
        mode: state.mode,
        audioPeak: state.audioPeak,
        multiBand: {
          bass: state.bass,
          mid: state.mid,
          treble: state.treble,
        },
        timeSec: (now - startTimeRef.current) / 1000,
      });
    };
    const isPlaying = () =>
      visibleRef.current &&
      documentVisibleRef.current &&
      !reducedMotionRef.current;
    const animate = (now: number) => {
      animFrameRef.current = null;
      if (!isPlaying()) {
        render(now);
        return;
      }
      // Source-card icons are numerous and too small to benefit from a full
      // display-rate update. Keep them on one RAF chain, but draw at ~10fps.
      const lastRender = lastAnimatedRenderRef.current;
      if (
        !smallIconRef.current ||
        lastRender === null ||
        now - lastRender >= 100
      ) {
        render(now);
        lastAnimatedRenderRef.current = now;
      }
      animFrameRef.current = requestAnimationFrame(animate);
    };
    const reconcile = () => {
      if (isPlaying()) {
        if (animFrameRef.current === null) {
          animFrameRef.current = requestAnimationFrame(animate);
        }
      } else {
        if (animFrameRef.current !== null) {
          cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = null;
        }
        render(performance.now());
      }
    };
    controlsRef.current = { render, reconcile };

    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            visibleRef.current = entries.some(
              (entry) => entry.target === canvas && entry.isIntersecting,
            );
            reconcile();
          });
    if (observer) {
      observer.observe(canvas);
    } else {
      // Older browsers and lightweight DOM test environments have no
      // observer; preserve the previous animated behavior there.
      visibleRef.current = true;
      reconcile();
    }

    const onVisibilityChange = () => {
      documentVisibleRef.current = !document.hidden;
      reconcile();
    };
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotionRef.current = event.matches;
      reconcile();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    motionQuery?.addEventListener('change', onMotionChange);
    render(performance.now());

    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      motionQuery?.removeEventListener('change', onMotionChange);
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (rendererRef.current && animFrameRef.current === null) {
      controlsRef.current.render(performance.now());
    }
  });

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
