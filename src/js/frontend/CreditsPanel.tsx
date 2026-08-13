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
    <section style={{ marginBottom: '2rem' }}>
      <h3
        style={{
          fontSize: '0.95rem',
          fontWeight: 600,
          margin: '0 0 0.75rem 0',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          opacity: 0.7,
        }}
      >
        {title}
      </h3>
      <div style={{ lineHeight: 1.7, fontSize: '0.9rem' }}>{children}</div>
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
      <strong>{name}</strong> · {creditRole}
    </>
  );

  if (url) {
    return (
      <div style={{ marginBottom: '0.5rem' }}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'inherit', textDecoration: 'none' }}
          title={url}
        >
          {content}
        </a>
      </div>
    );
  }

  return <div style={{ marginBottom: '0.5rem' }}>{content}</div>;
}

export function CreditsPanel() {
  return (
    <div
      style={{
        padding: '1.5rem',
        fontSize: '0.9rem',
        lineHeight: 1.6,
        maxWidth: '600px',
      }}
    >
      <h2 style={{ margin: '0 0 1.5rem 0', fontSize: '1.3rem' }}>
        About Stims
      </h2>

      <CreditsSection title="What is Stims?">
        <p>
          Stims is an independent browser-native visualizer built in the lineage
          of Ryan Geiss's MilkDrop. It provides a complete authoring and
          discovery environment for audio-reactive presets—with compatibility
          claims tied to measured evidence.
        </p>
        <p style={{ fontSize: '0.85rem', opacity: 0.8, marginTop: '0.75rem' }}>
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
        <p style={{ fontSize: '0.85rem', opacity: 0.8, marginTop: '0.75rem' }}>
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
        <p style={{ fontSize: '0.85rem', opacity: 0.8, marginTop: '0.75rem' }}>
          These projects maintain the format, expand the tooling, and preserve
          the preset ecosystem. Stims compatibility testing references projectM
          captures and code.
        </p>
      </CreditsSection>

      <CreditsSection title="Preset Authors & Curators">
        <p>
          The 1,787 presets in Stims' catalog are created and maintained by
          hundreds of artists in the demoscene and audio-visual community. Key
          contributors include:
        </p>
        <CreditEntry
          name="Eo.S."
          creditRole="Cream of the Crop curator & artist"
          url="https://github.com/projectM-visualizer/presets-cream-of-the-crop"
        />
        <CreditEntry
          name="Rovastar"
          creditRole="Classic MilkDrop packs & projectM development"
          url="https://sourceforge.net/projects/milkdrop2/"
        />
        <CreditEntry
          name="projectM Community"
          creditRole="Distributed preset packs & collections"
          url="https://github.com/projectM-visualizer/projectm/tree/master/src/libprojectM/presets"
        />
        <p style={{ fontSize: '0.85rem', opacity: 0.8, marginTop: '0.75rem' }}>
          Every preset in your library carries the work and creativity of its
          original author. Stims aims to make that authorship visible and
          linkable.
        </p>
      </CreditsSection>

      <CreditsSection title="This Implementation">
        <p>
          Stims is maintained as an independent project. The codebase references
          and builds upon decades of preset format research, demoscene
          innovation, and open-source visualization work—all of which is honored
          through code comments, test fixtures, and this credit page.
        </p>
        <p style={{ fontSize: '0.85rem', opacity: 0.8, marginTop: '0.75rem' }}>
          The full source lives at{' '}
          <a
            href={STIMS_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'inherit', textDecoration: 'underline' }}
          >
            github.com/zz-plant/stims
          </a>
          .
        </p>
        <p style={{ fontSize: '0.85rem', opacity: 0.8, marginTop: '0.75rem' }}>
          See{' '}
          <a
            href={`${STIMS_REPO_URL}/blob/main/docs/LINEAGE_AND_CREDITS.md`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'inherit', textDecoration: 'underline' }}
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
