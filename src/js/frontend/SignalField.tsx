/**
 * The waveform mark, in its two sizes.
 *
 * `LaunchSignalTrace` is the hairline under the wordmark. `StageSignalField`
 * is the same mark blown up to fill the stage, and exists because the landing
 * page had nothing else to look at: measured on a 1440x900 capture of both
 * production and dev, 97.4% of the frame sat below luma 8, and the entire
 * right half was a flat #050709 with a luma range of 0.6.
 *
 * The stage canvas is transparent wherever the preset draws nothing, so this
 * paints on the frame *below* the canvas: when attract mode has a real render
 * it covers this, and when it is gated off (low power, reduced motion) or
 * retires itself as blank (see the liveness judge in `workspace-hooks.ts`)
 * this is what remains. Costs no GPU context and no frame loop — it is CSS
 * over static SVG.
 */
import { useEffect, useRef } from 'react';
import {
  getAudioEnergy,
  subscribeAudioEnergy,
} from './engine-audio-energy-store.ts';

// One period is 150 viewBox units (both component frequencies divide it), so
// the CSS drift of -25% of the doubled 600-unit strip loops seamlessly.
const TRACE_PRIMARY =
  'M0,20.0 L6,25.2 L12,27.5 L18,26.6 L24,24.9 L30,25.2 L36,28.1 L42,31.2 L48,31.6 L54,28.2 L60,23.2 L66,19.8 L72,19.4 L78,20.6 L84,20.2 L90,16.8 L96,11.8 L102,8.4 L108,8.8 L114,11.9 L120,14.8 L126,15.1 L132,13.4 L138,12.5 L144,14.8 L150,20.0 L156,25.2 L162,27.5 L168,26.6 L174,24.9 L180,25.2 L186,28.1 L192,31.2 L198,31.6 L204,28.2 L210,23.2 L216,19.8 L222,19.4 L228,20.6 L234,20.2 L240,16.8 L246,11.8 L252,8.4 L258,8.8 L264,11.9 L270,14.8 L276,15.1 L282,13.4 L288,12.5 L294,14.8 L300,20.0 L306,25.2 L312,27.5 L318,26.6 L324,24.9 L330,25.2 L336,28.1 L342,31.2 L348,31.6 L354,28.2 L360,23.2 L366,19.8 L372,19.4 L378,20.6 L384,20.2 L390,16.8 L396,11.8 L402,8.4 L408,8.8 L414,11.9 L420,14.8 L426,15.1 L432,13.4 L438,12.5 L444,14.8 L450,20.0 L456,25.2 L462,27.5 L468,26.6 L474,24.9 L480,25.2 L486,28.1 L492,31.2 L498,31.6 L504,28.2 L510,23.2 L516,19.8 L522,19.4 L528,20.6 L534,20.2 L540,16.8 L546,11.8 L552,8.4 L558,8.8 L564,11.9 L570,14.8 L576,15.1 L582,13.4 L588,12.5 L594,14.8 L600,20.0';
const TRACE_ECHO =
  'M0,30.5 L6,30.2 L12,27.5 L18,25.5 L24,26.2 L30,28.4 L36,29.4 L42,26.8 L48,21.5 L54,16.6 L60,14.7 L66,15.6 L72,16.7 L78,15.4 L84,11.7 L90,8.3 L96,7.9 L102,11.1 L108,15.6 L114,18.3 L120,18.1 L126,16.9 L132,17.8 L138,21.9 L144,27.2 L150,30.5 L156,30.2 L162,27.5 L168,25.5 L174,26.2 L180,28.4 L186,29.4 L192,26.8 L198,21.5 L204,16.6 L210,14.7 L216,15.6 L222,16.7 L228,15.4 L234,11.7 L240,8.3 L246,7.9 L252,11.1 L258,15.6 L264,18.3 L270,18.1 L276,16.9 L282,17.8 L288,21.9 L294,27.2 L300,30.5 L306,30.2 L312,27.5 L318,25.5 L324,26.2 L330,28.4 L336,29.4 L342,26.8 L348,21.5 L354,16.6 L360,14.7 L366,15.6 L372,16.7 L378,15.4 L384,11.7 L390,8.3 L396,7.9 L402,11.1 L408,15.6 L414,18.3 L420,18.1 L426,16.9 L432,17.8 L438,21.9 L444,27.2 L450,30.5 L456,30.2 L462,27.5 L468,25.5 L474,26.2 L480,28.4 L486,29.4 L492,26.8 L498,21.5 L504,16.6 L510,14.7 L516,15.6 L522,16.7 L528,15.4 L534,11.7 L540,8.3 L546,7.9 L552,11.1 L558,15.6 L564,18.3 L570,18.1 L576,16.9 L582,17.8 L588,21.9 L594,27.2 L600,30.5';

/**
 * The product's pitch drawn as a picture: a signal trace and its visual echo,
 * one in each brand accent. Pure CSS drift, so it gives the launch page life
 * on exactly the devices where attract mode is gated off; reduced-motion gets
 * the static trace.
 *
 * Once audio flows (Play demo pressed, or a deep link auto-starting while
 * this header is still up), the trace amplitude follows live energy via the
 * `--stims-energy` custom property — the launch page starts moving to the
 * music before the stage takes over, so the handoff reads as one continuous
 * instrument rather than a page swap.
 */
export function LaunchSignalTrace() {
  const traceRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const updateEnergy = () => {
      const energy = Math.min(1, Math.max(0, getAudioEnergy()));
      traceRef.current?.style.setProperty('--stims-energy', String(energy));
    };
    updateEnergy();
    return subscribeAudioEnergy(updateEnergy);
  }, []);

  return (
    <div
      className="stims-shell__launch-trace"
      aria-hidden="true"
      ref={traceRef}
    >
      <svg viewBox="0 0 600 40" preserveAspectRatio="none" role="presentation">
        <g className="stims-shell__launch-trace-amp">
          <path
            d={TRACE_ECHO}
            fill="none"
            stroke="var(--stims-cool)"
            strokeWidth="1.4"
            opacity="0.45"
          />
          <path
            d={TRACE_PRIMARY}
            fill="none"
            stroke="var(--stims-accent)"
            strokeWidth="1.6"
          />
        </g>
      </svg>
    </div>
  );
}

/**
 * The rows of the stage field, back to front. Each is the same mark on a
 * different timebase, so the field reads as one instrument rather than as a
 * stack of ornament: `top` places it, `amp` stretches it, `span` sets how wide
 * the strip is drawn and therefore how many periods land in the frame, `dur`
 * desynchronises the drift, and `weight` keeps the far rows behind the near
 * ones. `flip` mirrors the trace vertically.
 *
 * `span` is the one that matters most and the reason it exists: with every row
 * drawn at the same width the rows shared a wavelength, the field read as
 * repeating wallpaper rather than as signal, and the eye caught the repeat
 * immediately. Spread across 150-360% they no longer line up. The drift needs
 * span >= 134% to stay seamless (it translates 25% of the strip, so the
 * remaining 75% has to still cover the frame).
 *
 * Alternating the two paths and the two accents is the whole palette — the
 * recorded direction for this chrome is two accents and no multi-hue
 * decorative gradient, and a landing page for a visuals product should be the
 * quietest surface in the app, not a competing one.
 */
const FIELD_ROWS = [
  {
    top: 6,
    amp: 1.2,
    span: 152,
    dur: 71,
    weight: 0.3,
    flip: false,
    path: TRACE_ECHO,
    cool: true,
  },
  {
    top: 19,
    amp: 2.6,
    span: 288,
    dur: 53,
    weight: 0.44,
    flip: false,
    path: TRACE_PRIMARY,
    cool: false,
  },
  {
    top: 31,
    amp: 1.6,
    span: 176,
    dur: 97,
    weight: 0.34,
    flip: true,
    path: TRACE_ECHO,
    cool: true,
  },
  {
    top: 44,
    amp: 3.2,
    span: 352,
    dur: 61,
    weight: 0.52,
    flip: false,
    path: TRACE_PRIMARY,
    cool: false,
  },
  {
    top: 57,
    amp: 1.9,
    span: 204,
    dur: 41,
    weight: 0.4,
    flip: true,
    path: TRACE_ECHO,
    cool: true,
  },
  {
    top: 68,
    amp: 3.6,
    span: 268,
    dur: 83,
    weight: 0.6,
    flip: false,
    path: TRACE_PRIMARY,
    cool: false,
  },
  {
    top: 80,
    amp: 2.2,
    span: 158,
    dur: 67,
    weight: 0.46,
    flip: true,
    path: TRACE_ECHO,
    cool: true,
  },
  {
    top: 90,
    amp: 4.2,
    span: 324,
    dur: 49,
    weight: 0.56,
    flip: false,
    path: TRACE_PRIMARY,
    cool: false,
  },
] as const;

/**
 * The landing page's floor: a graticule and a field of drifting traces, sized
 * to the stage. Rendered under the canvas, so a live attract render simply
 * paints over it and nothing here competes with a preset.
 */
export function StageSignalField() {
  return (
    <div className="stims-shell__stage-field" aria-hidden="true">
      <div className="stims-shell__stage-field-grid" />
      {FIELD_ROWS.map((row) => (
        <div
          key={row.top}
          className="stims-shell__stage-field-row"
          style={
            {
              '--row-top': `${row.top}%`,
              '--row-amp': row.amp,
              '--row-span': `${row.span}%`,
              '--row-dur': `${row.dur}s`,
              '--row-weight': row.weight,
              '--row-flip': row.flip ? -1 : 1,
            } as React.CSSProperties
          }
        >
          <svg
            viewBox="0 0 600 40"
            preserveAspectRatio="none"
            role="presentation"
          >
            {/* Drawn twice: a wide soft pass under a hairline, which is how a
                phosphor trace reads and what makes a 1px line survive being
                stretched across a 1440px stage. A blur filter would do the
                same thing and cost a compositor layer per row. */}
            <path
              d={row.path}
              fill="none"
              stroke={row.cool ? 'var(--stims-cool)' : 'var(--stims-accent)'}
              strokeWidth="7"
              strokeLinecap="round"
              opacity="0.22"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={row.path}
              fill="none"
              stroke={row.cool ? 'var(--stims-cool)' : 'var(--stims-accent)'}
              strokeWidth="1.6"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      ))}
    </div>
  );
}
