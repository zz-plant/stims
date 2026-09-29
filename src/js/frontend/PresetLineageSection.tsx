import { useMemo } from 'react';
import {
  buildForkTree,
  type ForkTreeNode,
  findPresetFamily,
} from '../milkdrop/preset-lineage.ts';
import type { PresetCatalogEntry } from './contracts.ts';

/**
 * The remix family of the preset currently playing.
 *
 * MilkDrop credits are accretive — a derivative keeps the base work's name and
 * every new hand joins the byline — so a preset's relatives are recoverable
 * from the catalog's own titles. Surfacing them turns a flat list into the
 * thing the format actually is: two decades of people building on each other.
 */
export function PresetLineageSection({
  catalog,
  currentPresetId,
  onSelect,
}: {
  catalog: PresetCatalogEntry[];
  currentPresetId: string | null;
  onSelect: (presetId: string) => void;
}) {
  const family = useMemo(
    () => (currentPresetId ? findPresetFamily(catalog, currentPresetId) : null),
    [catalog, currentPresetId],
  );

  if (!family) return null;

  const relatives = family.members.filter(
    (member) => member.id !== currentPresetId,
  );
  if (relatives.length === 0) return null;

  const tree = buildForkTree(family, catalog);
  const hasRecorded = family.members.some((member) =>
    catalog.some(
      (entry) =>
        entry.id === member.id &&
        family.members.some((m) => m.id === entry.derivedFrom?.[0]?.id),
    ),
  );

  const renderNode = (node: ForkTreeNode) => {
    const { member } = node;
    const isCurrent = member.id === currentPresetId;
    return (
      <li
        key={member.id}
        className="ctl-lineage__item"
        data-current={String(isCurrent)}
        data-root={String(member.isRoot)}
        data-link={node.link}
      >
        <button
          type="button"
          className="ctl-lineage__btn"
          aria-current={isCurrent ? 'true' : undefined}
          disabled={isCurrent}
          onClick={() => onSelect(member.id)}
        >
          <span className="ctl-lineage__label">
            {member.isRoot ? (
              <span className="ctl-lineage__root-tag">the original</span>
            ) : null}
            {node.link === 'recorded' ? (
              <span className="ctl-lineage__root-tag">remixed here</span>
            ) : null}
            {member.label}
            {member.shaderModel ? (
              <span className="ctl-lineage__shader">{member.shaderModel}</span>
            ) : null}
          </span>
          <span className="ctl-lineage__byline">
            {member.authors.join(' + ') || 'unattributed'}
            {member.addedAuthors.length > 0 ? (
              <span className="ctl-lineage__added">
                {' '}
                +{member.addedAuthors.join(', ')}
              </span>
            ) : null}
          </span>
        </button>
        {node.children.length > 0 ? (
          <ul className="ctl-lineage__list ctl-lineage__children">
            {node.children.map(renderNode)}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <section className="ctl-lineage" aria-labelledby="ctl-lineage-title">
      <h3 className="ctl-lineage__title" id="ctl-lineage-title">
        {relatives.length} more in the {family.baseTitle} family
      </h3>
      <ul className="ctl-lineage__list">{tree.map(renderNode)}</ul>
      <p className="ctl-lineage__note">
        Grouped by the credit convention in preset titles — evidence of a shared
        lineage, not proof of one. Variants hang under the original because
        titles do not say which sibling came from which
        {hasRecorded
          ? '; a remix made here is linked to the preset it came from.'
          : '.'}
      </p>
    </section>
  );
}
