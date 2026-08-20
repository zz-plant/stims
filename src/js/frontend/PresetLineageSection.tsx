import { useMemo } from 'react';
import { findPresetFamily } from '../milkdrop/preset-lineage.ts';
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

  return (
    <section className="ctl-lineage" aria-labelledby="ctl-lineage-title">
      <h3 className="ctl-lineage__title" id="ctl-lineage-title">
        {relatives.length} more in the {family.baseTitle} family
      </h3>
      <ul className="ctl-lineage__list">
        {family.members.map((member) => {
          const isCurrent = member.id === currentPresetId;
          return (
            <li
              key={member.id}
              className="ctl-lineage__item"
              data-current={String(isCurrent)}
              data-root={String(member.isRoot)}
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
                  {member.label}
                  {member.shaderModel ? (
                    <span className="ctl-lineage__shader">
                      {member.shaderModel}
                    </span>
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
            </li>
          );
        })}
      </ul>
      <p className="ctl-lineage__note">
        Reconstructed from the credit convention in preset titles — evidence of
        a shared lineage, not proof of one.
      </p>
    </section>
  );
}
