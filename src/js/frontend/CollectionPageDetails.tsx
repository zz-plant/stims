/**
 * The list a curated hub page (`/author/<slug>`, `/discover/<slug>`) stands
 * for, set below the stage: every preset in its collection, as links, under
 * letter headings once the list is long.
 *
 * Browse already opens on the collection, but it renders client-side and
 * virtualized, so a crawler saw 30-odd of a hub's presets and the raw HTML
 * none. The edge writes the same list into #app from the catalog table
 * (functions/_middleware.ts); this renders it from the loaded catalog through
 * the filter Browse opens with (discoveryRouteFilter), which is also the rule
 * the build used to mark each preset's topics in that table.
 */
import { Fragment, useMemo } from 'react';
import type { SemanticDiscoveryRoute } from '../../../functions/discover-slugs.ts';
import {
  buildCollectionContent,
  COLLECTION_HEADING_ID,
  type CollectionContent,
  collectionHeading,
  collectionLetterId,
} from '../../../functions/shared/collection-page.ts';
import { presetFileDirIndex } from '../../../functions/shared/preset-meta.ts';
import styles from '../../css/PresetPageDetails.module.css';
import type { PresetCatalogEntry } from './contracts.ts';
import { openPresetInPlace } from './preset-link.ts';
import { discoveryRouteFilter } from './workspace-helpers.ts';

/**
 * A hub's list from the loaded catalog. Only bundled presets count: the edge
 * lists the catalog table, which holds no imported or custom preset.
 */
export function collectionContentFromCatalog(
  catalog: readonly PresetCatalogEntry[],
  route: SemanticDiscoveryRoute,
): CollectionContent {
  const matches = discoveryRouteFilter(route);
  return buildCollectionContent(
    catalog.filter(
      (entry) =>
        presetFileDirIndex(entry.file ?? entry.bundledFile, entry.id) !==
          undefined && matches(entry),
    ),
    { showCredit: route.kind === 'topic' },
  );
}

/** The hub's list, or null when there is no hub. */
export function useCollectionPageContent(
  catalog: readonly PresetCatalogEntry[],
  route: SemanticDiscoveryRoute | null,
): CollectionContent | null {
  return useMemo(
    () => (route ? collectionContentFromCatalog(catalog, route) : null),
    [catalog, route],
  );
}

export function CollectionPageDetails({
  content,
  onSelectPreset,
}: {
  content: CollectionContent;
  onSelectPreset: (presetId: string) => void;
}) {
  return (
    <section
      className={`${styles.root} ${styles.collection}`}
      aria-labelledby={COLLECTION_HEADING_ID}
      data-collection-page
    >
      <h2 id={COLLECTION_HEADING_ID} className={styles.heading}>
        {collectionHeading(content.count)}
      </h2>
      {content.lettered ? (
        <nav className={styles.letters} aria-label="Presets by letter">
          <ul>
            {content.groups.map((group) => (
              <li key={group.letter}>
                <a href={`#${collectionLetterId(group.letter)}`}>
                  {group.letter}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {content.groups.map((group) => (
        <Fragment key={group.letter}>
          {content.lettered ? (
            <h3 id={collectionLetterId(group.letter)} className={styles.letter}>
              {group.letter}
            </h3>
          ) : null}
          <ul className={styles.columns}>
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
                {preset.credit ? (
                  <>
                    {' '}
                    <span className={styles.credit}>by {preset.credit}</span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </Fragment>
      ))}
    </section>
  );
}
