/**
 * The page a `?preset=` URL stands for, set below the stage: the playing
 * preset's name as the document's one h1, its author, its .milk file, the
 * topic hubs that list it, and more presets by that author. The site index
 * follows it (SiteIndexFooter).
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
import { Fragment, useId, useMemo } from 'react';
import { resolveSemanticRoute } from '../../../functions/discover-slugs.ts';
import {
  type PresetMetaTable,
  presetFileDirIndex,
} from '../../../functions/shared/preset-meta.ts';
import {
  buildPresetPageContent,
  CREDIT_SEPARATOR,
  PRESET_DOWNLOAD_LABEL,
  PRESET_TOPICS_HEADING,
  type PresetPageContent,
} from '../../../functions/shared/preset-page.ts';
import styles from '../../css/PresetPageDetails.module.css';
import type { PresetCatalogEntry } from './contracts.ts';
import { openPresetInPlace } from './preset-link.ts';
import { useWorkspace } from './workspace-context.tsx';
import { presetTopicMask } from './workspace-helpers.ts';

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
    table[entry.id] = [
      entry.title,
      entry.author ?? '',
      presetFileDirIndex(entry.file ?? entry.bundledFile, entry.id),
    ];
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
  return useMemo(() => {
    if (!table || !presetId) return null;
    const entry = catalog.find((preset) => preset.id === presetId);
    return buildPresetPageContent(
      table,
      presetId,
      entry ? presetTopicMask(entry) : 0,
    );
  }, [catalog, table, presetId]);
}

export function PresetPageDetails({
  content,
  onSelectPreset,
}: {
  content: PresetPageContent;
  onSelectPreset: (presetId: string) => void;
}) {
  const headingId = useId();
  const { ui } = useWorkspace();
  // An author's or topic's page is Browse filtered to it. Followed as a link
  // it reloaded the app and ended the audio, while the "More presets by"
  // links below switch in place; open the same filtered Browse in place.
  // A new-tab click still follows the href.
  const openHub = (href: string) => {
    const discovery = resolveSemanticRoute(href);
    if (!discovery) return false;
    ui.commitRoute((current) => ({
      ...current,
      panel: 'browse',
      collectionTag: discovery.collectionTag ?? null,
      discovery,
    }));
    return true;
  };
  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <h1 id={headingId} className={styles.title}>
        {content.title}
      </h1>
      <p className={styles.byline}>
        {content.credits.length > 0 ? (
          <>
            A MilkDrop preset by{' '}
            {content.credits.map((credit, index) => (
              <Fragment key={credit.name}>
                {index > 0 ? CREDIT_SEPARATOR : null}
                {credit.href ? (
                  <a
                    href={credit.href}
                    onClick={(event) => {
                      const href = credit.href;
                      if (!href) return;
                      openPresetInPlace(event, () => {
                        if (!openHub(href)) window.location.assign(href);
                      });
                    }}
                  >
                    {credit.name}
                  </a>
                ) : (
                  credit.name
                )}
              </Fragment>
            ))}
            .
          </>
        ) : (
          'A MilkDrop preset.'
        )}
      </p>
      {content.download ? (
        <p className={styles.download}>
          <a href={content.download} download>
            {PRESET_DOWNLOAD_LABEL}
          </a>
        </p>
      ) : null}
      {content.topics.length > 0 ? (
        <>
          <h2 className={styles.heading}>{PRESET_TOPICS_HEADING}</h2>
          <ul className={styles.related}>
            {content.topics.map((topic) => (
              <li key={topic.slug}>
                <a
                  href={topic.href}
                  onClick={(event) =>
                    openPresetInPlace(event, () => {
                      if (!openHub(topic.href)) {
                        window.location.assign(topic.href);
                      }
                    })
                  }
                >
                  {topic.heading}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {content.related.map((group) => (
        <Fragment key={group.author}>
          <h2 className={styles.heading}>More presets by {group.author}</h2>
          <ul className={styles.related}>
            {group.presets.map((preset) => (
              <li key={preset.id}>
                <a
                  href={preset.href}
                  onClick={(event) =>
                    openPresetInPlace(event, () => {
                      onSelectPreset(preset.id);
                      // Bring the stage, now playing this preset, into view.
                      window.scrollTo({ top: 0 });
                    })
                  }
                >
                  {preset.title}
                </a>
              </li>
            ))}
          </ul>
        </Fragment>
      ))}
    </section>
  );
}
