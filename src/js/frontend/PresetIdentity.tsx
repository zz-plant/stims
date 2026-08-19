import type { ReactNode } from 'react';
import type { MilkdropPresetRenderPreview } from '../milkdrop/preset-preview.ts';
import type { PresetCatalogEntry } from './contracts.ts';
import { PresetArtwork } from './PresetArtwork.tsx';

/**
 * How a preset presents itself inside a selectable control: its artwork, then
 * its name and a line of secondary detail.
 *
 * Every browse surface had hand-rolled this trio around the shared
 * `PresetArtwork` with its own class names and its own ellipsis rules, so the
 * three drifted (differing title weights, one of them missing `min-width: 0`
 * and so refusing to truncate). This owns the markup; the surrounding control
 * — button semantics, selection handlers, badges, layout — stays with each
 * call site, because those genuinely differ (a grid tile auditions on focus,
 * a search result closes its panel, a list row carries a sibling favourite
 * button).
 *
 * Renders as a fragment so it drops into whatever element the call site
 * already uses, and so absolutely-positioned overlays keep resolving against
 * that element rather than a wrapper introduced here.
 */
export function PresetIdentity({
  entry,
  title,
  subtitle,
  preview = null,
  audition = false,
  compact = false,
  artFallback = null,
}: {
  /** Null when the caller has a preset id but no catalog entry for it. */
  entry: PresetCatalogEntry | null;
  /** Overrides the entry title; required when `entry` is null. */
  title?: string;
  subtitle?: ReactNode;
  preview?: MilkdropPresetRenderPreview | null;
  /** Render a live engine tile in the artwork slot (grid hover/focus). */
  audition?: boolean;
  compact?: boolean;
  /** Stands in for the artwork when there is no entry to draw. */
  artFallback?: ReactNode;
}) {
  return (
    <>
      {entry ? (
        <PresetArtwork
          entry={entry}
          preview={preview}
          audition={audition}
          compact={compact}
        />
      ) : (
        artFallback
      )}
      <span className="stims-preset-identity">
        <span className="stims-preset-identity__title">
          {title ?? entry?.title}
        </span>
        {subtitle ? (
          <span className="stims-preset-identity__subtitle">{subtitle}</span>
        ) : null}
      </span>
    </>
  );
}
