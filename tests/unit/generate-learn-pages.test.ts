import { describe, expect, test } from 'bun:test';
import {
  buildLearnArtifacts,
  extractFaq,
  LEARN_PAGES,
  learnPagePath,
  renderLearnMarkdown,
  rewriteLearnHref,
  slugifyHeading,
} from '../../scripts/generate-learn-pages.ts';

/**
 * The /learn/ pages are the site's crawlable prose, generated from markdown
 * written to be read on GitHub. What can silently break in that translation is
 * links: a relative `.md` link, a `#anchor` that GitHub resolves but the
 * generated page does not, or a diagram that turns into raw source.
 */
describe('learn page link rewriting', () => {
  const src = 'docs/authoring/02-motion.md';

  test('sibling curriculum links become /learn/ URLs and keep their anchor', () => {
    expect(rewriteLearnHref('03-listening.md', src)).toBe('/learn/listening/');
    expect(rewriteLearnHref('06-shaders.md#lesson-5', src)).toBe(
      '/learn/shaders/#lesson-5',
    );
    expect(rewriteLearnHref('README.md', src)).toBe('/learn/');
  });

  test('repo files outside the curriculum point at GitHub', () => {
    expect(
      rewriteLearnHref('../../CONTRIBUTING.md#contributing-presets', src),
    ).toBe(
      'https://github.com/zz-plant/stims/blob/main/CONTRIBUTING.md#contributing-presets',
    );
    expect(rewriteLearnHref('examples/', src)).toBe(
      'https://github.com/zz-plant/stims/tree/main/docs/authoring/examples',
    );
  });

  test('absolute, site-absolute and anchor links pass through', () => {
    for (const href of [
      'https://toil.fyi/#code=abc',
      '/performance/',
      '#top',
    ]) {
      expect(rewriteLearnHref(href, src)).toBe(href);
    }
  });
});

describe('learn page rendering', () => {
  test('heading ids match GitHub so existing anchors keep working', () => {
    expect(slugifyHeading('Lesson 0 — A language note stated plainly')).toBe(
      'lesson-0--a-language-note-stated-plainly',
    );
  });

  test('repeated headings get distinct ids', () => {
    const { headings } = renderLearnMarkdown('## Setup\n\n## Setup\n', 'x.md');
    expect(headings.map((h) => h.id)).toEqual(['setup', 'setup-1']);
  });

  test('mermaid diagrams become a text-form <details>, and code is escaped', () => {
    const { html } = renderLearnMarkdown(
      '```mermaid\nA[<script>] --> B\n```\n',
      'x.md',
    );
    expect(html).toContain('<details class="diagram">');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('FAQPage answers are exactly the visible answers', () => {
    const { html } = renderLearnMarkdown(
      '## FAQ\n\n### Is it free?\n\nYes, **free**.\n\n### Is it fast?\n\nVery.\n',
      'x.md',
    );
    expect(extractFaq(html)).toEqual([
      { q: 'Is it free?', a: 'Yes, free.' },
      { q: 'Is it fast?', a: 'Very.' },
    ]);
  });
});

describe('generated learn corpus', () => {
  const artifacts = buildLearnArtifacts();
  const idsByPath = new Map(
    LEARN_PAGES.map((page) => {
      const html = artifacts.get(
        `public/learn/${page.slug ? `${page.slug}/` : ''}index.html`,
      ) as string;
      return [
        learnPagePath(page),
        new Set([...html.matchAll(/ id="([^"]+)"/gu)].map((m) => m[1])),
      ] as const;
    }),
  );

  test('every /learn/ link with an anchor points at a heading that exists', () => {
    const broken: string[] = [];
    for (const [file, html] of artifacts) {
      for (const [, target, hash] of html.matchAll(
        /href="(\/learn\/[^"#]*)#([^"]+)"/gu,
      )) {
        if (!idsByPath.get(target as string)?.has(hash as string)) {
          broken.push(`${file} → ${target}#${hash}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  test('landing pages ship FAQ JSON-LD that matches their visible FAQ', () => {
    const html = artifacts.get(
      'public/learn/milkdrop-online/index.html',
    ) as string;
    const json = JSON.parse(
      html.match(
        /<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/u,
      )?.[1] ?? '{}',
    );
    const faq = json['@graph'].find(
      (node: { '@type': string }) => node['@type'] === 'FAQPage',
    );
    expect(faq.mainEntity.length).toBeGreaterThanOrEqual(4);
    for (const question of faq.mainEntity) {
      expect(html).toContain(question.name);
    }
  });
});
