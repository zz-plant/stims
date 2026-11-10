/**
 * The Continuous Aesthetic Compass: a 2D map of every previewed preset,
 * projected from the shipped visual embeddings. Dragging the puck picks the
 * nearest preset, so a visitor can steer by look instead of by name.
 *
 * The projection lives in `aesthetic-compass.ts`; this component only draws
 * it and turns a pointer or arrow-key position into a selection.
 */
import '../../css/shell/aesthetic-compass.css';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import {
  type AestheticCompass,
  loadAestheticCompass,
} from '../core/services/aesthetic-compass.ts';

const PAD_SIZE = 220;
const DOT_RADIUS = 1.6;
/** Arrow-key travel in plane units (the plane spans -1..1). */
const KEY_STEP = 0.08;
const KEY_STEP_COARSE = 0.25;

type PlanePoint = { x: number; y: number };

const clampUnit = (value: number) => Math.min(1, Math.max(-1, value));

/** Plane coordinates (y up) to CSS percentages inside the pad (y down). */
const toPadPosition = (point: PlanePoint) => ({
  left: `${((point.x + 1) / 2) * 100}%`,
  top: `${((1 - point.y) / 2) * 100}%`,
});

export function AestheticCompassPad({
  onSelectPreset,
  isSelectable,
  describePreset,
  currentPresetId = null,
}: {
  onSelectPreset: (presetId: string) => void;
  /** Skip presets the catalog hides, e.g. flashing ones under Reduce flashing. */
  isSelectable?: (presetId: string) => boolean;
  /** A preset's display name; the readout falls back to the id without it. */
  describePreset?: (presetId: string) => string | null;
  /** The preset on stage, ringed on the map. */
  currentPresetId?: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<HTMLDivElement | null>(null);
  const readoutId = useId();
  const [compass, setCompass] = useState<AestheticCompass | null>(null);
  const [loading, setLoading] = useState(true);
  const [puck, setPuck] = useState<PlanePoint | null>(null);
  const [nearest, setNearest] = useState<string | null>(null);
  const [played, setPlayed] = useState<string | null>(null);
  // The readout names the gesture that plays: release for a pointer, Enter
  // for the keyboard.
  const [byKeyboard, setByKeyboard] = useState(false);

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
    // The pad sets `color` from the on-stage palette; the dots inherit it.
    ctx.fillStyle = getComputedStyle(canvas).color;
    ctx.globalAlpha = 0.55;
    for (const point of compass.points) {
      const x = ((point.x + 1) / 2) * PAD_SIZE;
      const y = ((1 - point.y) / 2) * PAD_SIZE;
      ctx.beginPath();
      ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [compass]);

  if (loading) {
    return (
      <div className="ctl-compass" aria-busy="true">
        <div className="ctl-compass__pad" />
        <p className="ctl-compass__readout">Loading the map of looks…</p>
      </div>
    );
  }
  if (!compass) {
    return (
      <p className="ctl-section__note">
        The map is drawn from the preset previews, and they did not load. The
        list below still has every preset.
      </p>
    );
  }

  const playingPoint = currentPresetId
    ? (compass.points.find((point) => point.presetId === currentPresetId) ??
      null)
    : null;
  const nameOf = (presetId: string) => describePreset?.(presetId) ?? presetId;

  const moveTo = (point: PlanePoint, commit: boolean) => {
    const next = { x: clampUnit(point.x), y: clampUnit(point.y) };
    setPuck(next);
    const id = compass.nearestPreset(next.x, next.y, isSelectable);
    setNearest(id);
    if (commit && id) {
      setPlayed(id);
      onSelectPreset(id);
    } else {
      setPlayed(null);
    }
  };

  const pointerToPlane = (clientX: number, clientY: number): PlanePoint => {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    // Canvas y grows down; the plane's y grows up.
    return {
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: 1 - ((clientY - rect.top) / rect.height) * 2,
    };
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_STEP_COARSE : KEY_STEP;
    const from = puck ?? playingPoint ?? { x: 0, y: 0 };
    let next: PlanePoint | null = null;
    if (event.key === 'ArrowLeft') next = { x: from.x - step, y: from.y };
    else if (event.key === 'ArrowRight') next = { x: from.x + step, y: from.y };
    else if (event.key === 'ArrowUp') next = { x: from.x, y: from.y + step };
    else if (event.key === 'ArrowDown') next = { x: from.x, y: from.y - step };
    const commit = event.key === 'Enter' || event.key === ' ';
    if (!next && !commit) return;
    // Browse steers its preset list with the same keys; keep them here.
    event.preventDefault();
    event.stopPropagation();
    setByKeyboard(true);
    moveTo(next ?? from, commit);
  };

  return (
    <div className="ctl-compass">
      <span className="ctl-compass__axis ctl-compass__axis--top">
        {compass.yAxis.positive}
      </span>
      <span className="ctl-compass__axis ctl-compass__axis--left">
        {compass.xAxis.negative}
      </span>
      {/* A slider in two dimensions, as colour pads are: arrows move the
          puck, Enter plays, and the value read out is the preset under it. */}
      <div
        ref={padRef}
        className="ctl-compass__pad"
        role="slider"
        tabIndex={0}
        aria-label="Map of looks. Arrow keys move, Enter plays the nearest preset."
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={Math.round((puck?.x ?? 0) * 100)}
        aria-valuetext={nearest ? nameOf(nearest) : 'No preset picked yet'}
        aria-describedby={readoutId}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setByKeyboard(false);
          moveTo(pointerToPlane(event.clientX, event.clientY), false);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          moveTo(pointerToPlane(event.clientX, event.clientY), false);
        }}
        onPointerUp={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          moveTo(pointerToPlane(event.clientX, event.clientY), true);
        }}
        onPointerCancel={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        <canvas
          ref={canvasRef}
          className="ctl-compass__canvas"
          width={PAD_SIZE}
          height={PAD_SIZE}
        />
        {playingPoint ? (
          <span
            className="ctl-compass__playing"
            style={toPadPosition(playingPoint)}
          />
        ) : null}
        {puck ? (
          <span className="ctl-compass__puck" style={toPadPosition(puck)} />
        ) : null}
      </div>
      <span className="ctl-compass__axis ctl-compass__axis--right">
        {compass.xAxis.positive}
      </span>
      <span className="ctl-compass__axis ctl-compass__axis--bottom">
        {compass.yAxis.negative}
      </span>
      <p className="ctl-compass__readout" id={readoutId} aria-live="polite">
        {played ? (
          <>
            Playing <strong>{nameOf(played)}</strong>
          </>
        ) : nearest ? (
          <>
            {byKeyboard ? 'Press Enter' : 'Release'} to play{' '}
            <strong>{nameOf(nearest)}</strong>
          </>
        ) : (
          'Each dot is a preset, placed by how it looks. Drag across the map and release to play the nearest one.'
        )}
      </p>
    </div>
  );
}
