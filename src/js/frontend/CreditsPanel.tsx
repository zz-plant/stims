import type { ReactNode } from 'react';
import { STIMS_REPO_URL } from './workspace-helpers.ts';

function CreditsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="stims-credits-section">
      <h3 className="stims-credits-section-title">{title}</h3>
      <div className="stims-credits-body">{children}</div>
    </section>
  );
}

function CreditEntry({
  name,
  creditRole,
  url,
}: {
  name: string;
  creditRole: string;
  url?: string;
}) {
  const content = (
    <>
      <strong className="stims-credits-entry-name">{name}</strong> ·{' '}
      <span className="stims-credits-entry-role">{creditRole}</span>
    </>
  );

  if (url) {
    return (
      <div className="stims-credits-entry">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="stims-credits-entry-link"
          title={url}
        >
          {content}
        </a>
      </div>
    );
  }

  return <div className="stims-credits-entry">{content}</div>;
}

export function CreditsPanel() {
  return (
    <div className="stims-credits-panel">
      <h2 className="stims-credits-title">About Stims</h2>

      <CreditsSection title="What is Stims?">
        <p>
          Stims is an independent browser-native visualizer built in the lineage
          of Ryan Geiss's MilkDrop. It provides a complete authoring and
          discovery environment for audio-reactive presets—with compatibility
          claims tied to measured evidence.
        </p>
        <p className="stims-credits-disclaimer">
          Stims is not affiliated with or endorsed by MilkDrop, Winamp,
          projectM, or Butterchurn. Each project is independent, and this
          lineage is acknowledged with respect.
        </p>
      </CreditsSection>

      <CreditsSection title="Foundational Works">
        <CreditEntry
          name="Ryan Geiss"
          creditRole="Creator, MilkDrop"
          url="http://www.geisswerks.com/milkdrop/"
        />
        <CreditEntry
          name="Winamp & Nullsoft"
          creditRole="Original public product context"
        />
        <p className="stims-credits-disclaimer">
          MilkDrop defined the preset language, visual vocabulary, and real-time
          visualization paradigm that audio-reactive presets are built on today.
        </p>
      </CreditsSection>

      <CreditsSection title="Active Ecosystem">
        <CreditEntry
          name="projectM"
          creditRole="Open-source successor & reference implementation"
          url="https://github.com/projectM-visualizer/projectm"
        />
        <CreditEntry
          name="Butterchurn"
          creditRole="Web-based MilkDrop player"
          url="https://butterchurnviz.com/"
        />
        <p className="stims-credits-disclaimer">
          These projects maintain the format, expand the tooling, and preserve
          the preset ecosystem. Stims compatibility testing references projectM
          captures and code.
        </p>
      </CreditsSection>

      <CreditsSection title="Preset Authors & Curators">
        <p>
          The 1,787 presets in Stims' catalog were made by roughly 140 authors.
          Counting every appearance in a credit chain rather than only solo
          bylines, the most-credited are Geiss, Flexi, Martin, Rovastar, Eo.S.,
          Stahlregen, Unchained, fiShbRaiN, Phat, and Aderrasi.
        </p>
        <CreditEntry
          name="Rovastar"
          creditRole="Classic-era author; researched the cross-vendor texel-alignment fix credited in Geiss's MilkDrop changelog"
        />
        <CreditEntry
          name="Krash"
          creditRole="Classic-era author; his beat-detection routine circulated scene-wide, credited inline in preset titles"
        />
        <p>Curation decided which presets most people ever saw:</p>
        <CreditEntry
          name="djdafreund"
          creditRole="Compiler, Better Living Through Chemicals (BLTC) — ships inside projectM as bltc201"
        />
        <CreditEntry
          name="Jason Fletcher / ISOSCELES"
          creditRole="Compiler, Cream of the Crop — the default projectM preset pack since 2022"
          url="https://github.com/projectM-visualizer/presets-cream-of-the-crop"
        />
        <p className="stims-credits-disclaimer">
          MilkDrop credits are accretive: a remixer joins the byline rather than
          replacing it, so a title like "Stahlregen &amp; Geiss + Rovastar +
          Illusion + Krash + Rozzor — Cyclopean Shift (Eyeless Mix)" names six
          hands on one work. Stims preserves those chains in full and never
          truncates them to "and others."
        </p>
      </CreditsSection>

      <CreditsSection title="This Implementation">
        <p>
          Stims is maintained as an independent project. The codebase references
          and builds upon decades of preset format research, demoscene
          innovation, and open-source visualization work—all of which is honored
          through code comments, test fixtures, and this credit page.
        </p>
        <p className="stims-credits-disclaimer">
          The full source lives at{' '}
          <a
            href={STIMS_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="stims-credits-link"
          >
            github.com/zz-plant/stims
          </a>
          .
        </p>
        <p className="stims-credits-disclaimer">
          See{' '}
          <a
            href={`${STIMS_REPO_URL}/blob/main/docs/LINEAGE_AND_CREDITS.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="stims-credits-link"
          >
            LINEAGE_AND_CREDITS.md
          </a>{' '}
          in the repository for detailed attribution guidance and contributor
          rules.
        </p>
      </CreditsSection>

      <CreditsSection title="License">
        <p>
          Stims is released under the Unlicense (public domain). Presets retain
          their original licenses. When you use, share, or remix presets, please
          credit the original authors—you'll see their names and links
          throughout the app.
        </p>
      </CreditsSection>
    </div>
  );
}
