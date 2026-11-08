/**
 * The Continuous Aesthetic Compass: a 2D map of every previewed preset,
 * projected from the shipped visual embeddings. Dragging the puck picks the
 * nearest preset, so a visitor can steer by look instead of by name.
 *
 * The projection lives in `aesthetic-compass.ts`; this component only draws
 * it and turns a pointer position into a selection.
 */
import '../../css/shell/aesthetic-compass.css';
import { useEffect, useRef, useState } from 'react';
import {
  type AestheticCompass,
  loadAestheticCompass,
} from '../core/services/aesthetic-compass.ts';

const PAD_SIZE = 220;
const DOT_RADIUS = 1.6;
const PUCK_RADIUS = 7;

export function AestheticCompassPad({
  onSelectPreset,
  isSelectable,
}: {
  onSelectPreset: (presetId: string) => void;
  /** Skip presets the catalog hides, e.g. flashing ones under Reduce flashing. */
  isSelectable?: (presetId: string) => boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [compass, setCompass] = useState<AestheticCompass | null>(null);
  const [loading, setLoading] = useState(true);
  const [puck, setPuck] = useState<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadAestheticCompass().then((result) => {
      if (cancelled) return;
      setCompass(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Draw the dots whenever the projection arrives.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !compass) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = PAD_SIZE * dpr;
    canvas.height = PAD_SIZE * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, PAD_SIZE, PAD_SIZE);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    for (const point of compass.points) {
      const x = ((point.x + 1) / 2) * PAD_SIZE;
      const y = ((1 - point.y) / 2) * PAD_SIZE;
      ctx.beginPath();
      ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [compass]);

  if (loading) {
    return <p className="ctl-section__note">Loading the aesthetic map…</p>;
  }
  if (!compass) {
    return (
      <p className="ctl-section__note">
        The aesthetic map needs the preview vectors, which are not available
        right now.
      </p>
    );
  }

  const pick = (clientX: number, clientY: number, commit: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const nx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const ny = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    // Canvas y grows down; the plane's y grows up.
    const x = nx * 2 - 1;
    const y = (1 - ny) * 2 - 1;
    setPuck({ x, y });
    const id = compass.nearestPreset(x, y, isSelectable);
    setHovered(id);
    if (commit && id) onSelectPreset(id);
  };

  return (
    <div className="ctl-compass">
      <div className="ctl-compass__pad">
        <canvas
          ref={canvasRef}
          width={PAD_SIZE}
          height={PAD_SIZE}
          style={{ width: '100%', height: 'auto', display: 'block' }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            pick(event.clientX, event.clientY, false);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            pick(event.clientX, event.clientY, false);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            pick(event.clientX, event.clientY, true);
          }}
          aria-label="Aesthetic compass: drag to pick a look"
        />
        {puck ? (
          <span
            className="ctl-compass__puck"
            style={{
              left: `${((puck.x + 1) / 2) * 100}%`,
              top: `${((1 - puck.y) / 2) * 100}%`,
            }}
          />
        ) : null}
      </div>
      <div className="ctl-compass__axes">
        <span>{compass.yAxis.positive}</span>
        <span>{compass.yAxis.negative}</span>
        <span>{compass.xAxis.negative}</span>
        <span>{compass.xAxis.positive}</span>
      </div>
      <p className="ctl-section__note">
        {hovered
          ? `Nearest: ${hovered}`
          : 'Drag across the map to pick a look. Release to play it.'}
      </p>
    </div>
  );
}
