/**
 * What the chrome prints on a preset's swatch strip: its catalog number and
 * its transmission graph. The strip itself (card stock, die-cut corners, the
 * rivet hole) is CSS, in src/css/shell/swatch.css.
 *
 * A lighting-gel swatch prints a graph of the light its filter passes. A
 * preset's strip prints the same thing for sound: three columns, bass, mid
 * and treble, each showing the band's live level. The bands the preset's
 * equations read are lit in the safelight amber; the ones it ignores stay in
 * spec grey, still moving, so the graph says both what is playing and what
 * this preset does with it (preset-band-reads.ts has the reading). Where
 * there is room, the graph's own legend says so in words ("Driven by"), and
 * its accessible name spells the reading out, so the lit/grey difference is
 * never carried by colour alone.
 *
 * Levels are written straight onto the element as custom properties from the
 * audio store's subscription, never through React state and never through a
 * CSS transition, which would restart on every frame.
 */
import { useEffect, useRef } from 'react';
import {
  getAudioBands,
  subscribeAudioEnergy,
} from './engine-audio-energy-store.ts';
import { type BandReads, cachedBandReads } from './preset-band-reads.ts';
import { useEngineSnapshot } from './workspace-context.tsx';

const BANDS = [
  { key: 'bass', label: 'Bass' },
  { key: 'mid', label: 'Mid' },
  { key: 'treble', label: 'Treble' },
] as const;

/** The bands the preset on stage reads, from the compile the engine runs;
 * null until a compile is on stage, when there is nothing to read yet. */
export function useStageBandReads(): BandReads | null {
  const { engineSnapshot } = useEngineSnapshot();
  const ir = engineSnapshot?.sessionState?.activeCompiled?.ir;
  return ir ? cachedBandReads(ir) : null;
}

const joinBands = (names: readonly string[], conjunction: string) =>
  names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} ${conjunction} ${names.at(-1)}`;

/** The graph's reading in words: `Driven by bass and treble`. */
export function describeBandReads(reads: BandReads | null): string {
  if (!reads) return 'Bass, mid and treble levels';
  const lit = BANDS.filter((band) => reads[band.key]).map((band) =>
    band.label.toLowerCase(),
  );
  return lit.length > 0
    ? `Driven by ${joinBands(lit, 'and')}`
    : 'Not driven by bass, mid or treble';
}

export function SwatchGraph({
  reads = null,
  className,
  labels = true,
  orient = 'columns',
}: {
  reads?: BandReads | null;
  className?: string;
  /** Print the band names under the columns. The dock's edge graph has no
   * room for them; the cover and the title card do. */
  labels?: boolean;
  /** `columns` rise from a baseline; `edge` runs as three horizontal meters
   * along a strip's top edge, where there is no height to rise into. */
  orient?: 'columns' | 'edge';
}) {
  const graphRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const paint = () => {
      const node = graphRef.current;
      if (!node) return;
      const bands = getAudioBands();
      node.style.setProperty('--band-bass', bands.bass.toFixed(3));
      node.style.setProperty('--band-mid', bands.mid.toFixed(3));
      node.style.setProperty('--band-treble', bands.treble.toFixed(3));
    };
    paint();
    return subscribeAudioEnergy(paint);
  }, []);

  return (
    <div
      ref={graphRef}
      className={
        className ? `stims-swatch-graph ${className}` : 'stims-swatch-graph'
      }
      data-labels={labels ? 'true' : 'false'}
      data-legend={labels && reads ? 'true' : 'false'}
      data-orient={orient}
      role="img"
      aria-label={describeBandReads(reads)}
    >
      {labels && reads ? (
        <span className="stims-swatch-graph__legend" aria-hidden="true">
          Driven by
        </span>
      ) : null}
      {BANDS.map((band) => (
        <span
          key={band.key}
          className="stims-swatch-graph__band"
          data-band={band.key}
          data-lit={reads?.[band.key] ? 'true' : 'false'}
        >
          <span className="stims-swatch-graph__level" />
          {labels ? (
            <span className="stims-swatch-graph__label">{band.label}</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

/** `0009` for catalog number 9; null when the preset has no number. */
export function formatCatalogNumber(value: number | undefined): string | null {
  if (value === undefined || !Number.isFinite(value) || value < 0) return null;
  return String(Math.trunc(value)).padStart(4, '0');
}

/**
 * The catalog number as a swatch prints it: the digits, narrow and heavy, with
 * a small "No." before them. An edited preset keeps its parent's number and
 * adds an "edited" mark, so the lineage stays on the strip. Renders nothing
 * for a preset that is not in the catalog rather than inventing a number.
 * Screen readers hear "Catalog number 9", not "No zero zero zero nine".
 */
export function SwatchNumber({
  value,
  edited = false,
  className,
}: {
  value: number | undefined;
  edited?: boolean;
  className?: string;
}) {
  const digits = formatCatalogNumber(value);
  if (!digits) return null;
  return (
    <span
      className={
        className ? `stims-swatch-number ${className}` : 'stims-swatch-number'
      }
      title={edited ? 'Catalog number (edited)' : 'Catalog number'}
    >
      <span className="sr-only">
        {edited
          ? `Catalog number ${Math.trunc(value ?? 0)}, edited`
          : `Catalog number ${Math.trunc(value ?? 0)}`}
      </span>
      <span className="stims-swatch-number__prefix" aria-hidden="true">
        No.
      </span>
      <span className="stims-swatch-number__digits" aria-hidden="true">
        {digits}
      </span>
      {edited ? (
        <span className="stims-swatch-number__edit" aria-hidden="true">
          edited
        </span>
      ) : null}
    </span>
  );
}
