/**
 * The page a `?preset=` URL stands for, set below the stage: the playing
 * preset's name as the document's one h1, its author, more presets by that
 * author, and the topic hubs.
 *
 * Search engines render this page and skip <noscript>, which is the only
 * place the edge middleware could put this content. Without this section
 * every preset URL in the sitemap rendered the same heading ("Stims
 * visualizer") over the same few hundred characters of chrome. The section
 * and the middleware's fallback are both built by `buildPresetPageContent`
 * (functions/shared/preset-page.ts), so they describe the same page.
 *
 * It sits in normal flow after the full-viewport stage. Nothing overlaps the
 * visuals, and the stage keeps its wheel and touch gestures; the section is
 * reached by scrolling the page, by Tab, or from a screen reader's headings.
 */
import { type MouseEvent, useId, useMemo } from 'react';
import type { PresetMetaTable } from '../../../functions/shared/preset-meta.ts';
import {
  buildPresetPageContent,
  PRESET_PAGE_HUB_LINKS,
  type PresetPageContent,
} from '../../../functions/shared/preset-page.ts';
import styles from '../../css/PresetPageDetails.module.css';
import type { PresetCatalogEntry } from './contracts.ts';

/**
 * The catalog in the shape the edge reads from /preset-meta.json. First entry
 * wins, as in `buildPresetMetaMap` (scripts/generate-seo.ts), so both sides
 * pick the same related presets.
 */
export function presetMetaTableFromCatalog(
  catalog: readonly PresetCatalogEntry[],
): PresetMetaTable {
  const table: PresetMetaTable = {};
  for (const entry of catalog) {
    if (table[entry.id]) continue;
    table[entry.id] = [entry.title, entry.author ?? ''];
  }
  return table;
}

/** Page content for `presetId`, or null when there is no preset to describe. */
export function usePresetPageContent(
  catalog: readonly PresetCatalogEntry[],
  presetId: string | null,
): PresetPageContent | null {
  const active = presetId !== null;
  const table = useMemo(
    () => (active ? presetMetaTableFromCatalog(catalog) : null),
    [active, catalog],
  );
  return useMemo(
    () => (table && presetId ? buildPresetPageContent(table, presetId) : null),
    [table, presetId],
  );
}

function isPlainClick(event: MouseEvent) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function PresetPageDetails({
  content,
  onSelectPreset,
}: {
  content: PresetPageContent;
  onSelectPreset: (presetId: string) => void;
}) {
  const headingId = useId();
  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <h1 id={headingId} className={styles.title}>
        {content.title}
      </h1>
      <p className={styles.byline}>
        {content.author ? (
          <>
            A MilkDrop preset by{' '}
            {content.authorHref ? (
              <a href={content.authorHref}>{content.author}</a>
            ) : (
              content.author
            )}
            .
          </>
        ) : (
          'A MilkDrop preset.'
        )}
      </p>
      {content.related.length > 0 ? (
        <>
          <h2 className={styles.heading}>More presets by {content.author}</h2>
          <ul className={styles.related}>
            {content.related.map((preset) => (
              <li key={preset.id}>
                <a
                  href={preset.href}
                  onClick={(event) => {
                    if (!isPlainClick(event)) return;
                    // Following the link would reload the app and end the
                    // audio session; switch presets in place instead, and
                    // bring the stage back into view.
                    event.preventDefault();
                    onSelectPreset(preset.id);
                    window.scrollTo({ top: 0 });
                  }}
                >
                  {preset.title}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <nav className={styles.hubs} aria-label="Related pages">
        <ul>
          {PRESET_PAGE_HUB_LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
