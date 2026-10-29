import { describe, expect, test } from 'bun:test';
import {
  LEARN_PAGES,
  learnMarkdownPath,
  learnPagePath,
  learnRequestTarget,
} from '../../functions/shared/learn-pages.ts';
import {
  buildLearnArtifacts,
  renderLearnMarkdownSource,
} from '../../scripts/generate-learn-pages.ts';

// Every /learn/ page exists twice on the wire — HTML and a markdown sibling —
// and the middleware picks between them from the request path and Accept
// header. A mapping that drifts from the generated files would serve 404s or
// the wrong representation, so the mapping and the artifacts are tested
// against each other here.

describe('learnRequestTarget', () => {
  test('maps the hub in both spellings and its markdown', () => {
    const hub = LEARN_PAGES[0];
    expect(hub?.slug).toBe('');
    expect(learnRequestTarget('/learn')).toEqual({ kind: 'html', page: hub });
    expect(learnRequestTarget('/learn/')).toEqual({ kind: 'html', page: hub });
    expect(learnRequestTarget('/learn.md')).toEqual({
      kind: 'markdown',
      page: hub,
    });
  });

  test('maps every page slug to HTML and markdown', () => {
    for (const page of LEARN_PAGES) {
      if (page.slug === '') continue;
      const bare = `/learn/${page.slug}`;
      expect(learnRequestTarget(bare)).toEqual({ kind: 'html', page });
      expect(learnRequestTarget(`${bare}/`)).toEqual({ kind: 'html', page });
      expect(learnRequestTarget(`${bare}.md`)).toEqual({
        kind: 'markdown',
        page,
      });
    }
  });

  test('unknown or nested paths keep their asset answer (usually 404)', () => {
    expect(learnRequestTarget('/learn/not-a-page/')).toBeNull();
    expect(learnRequestTarget('/learn/not-a-page.md')).toBeNull();
    expect(learnRequestTarget('/learn/a/b/')).toBeNull();
    expect(learnRequestTarget('/learning/')).toBeNull();
    expect(learnRequestTarget('/learn.md.txt')).toBeNull();
  });

  test('markdown paths are the HTML paths with .md swapped for the slash', () => {
    for (const page of LEARN_PAGES) {
      expect(learnMarkdownPath(page)).toBe(
        learnPagePath(page).replace(/\/$/u, '.md'),
      );
    }
  });
});

describe('renderLearnMarkdownSource', () => {
  test('names the canonical HTML URL and repo source in frontmatter', () => {
    const page = LEARN_PAGES.find((candidate) => candidate.slug === 'play');
    if (!page) throw new Error('play page missing');
    const markdown = renderLearnMarkdownSource(page);
    expect(markdown).toMatch(/^---\n/);
    expect(markdown).toContain(`url: https://toil.fyi${learnPagePath(page)}`);
    expect(markdown).toContain(
      `source: https://github.com/zz-plant/stims/blob/main/${page.source}`,
    );
  });

  test('rewrites relative links to site or GitHub URLs, keeps the rest', () => {
    const page = LEARN_PAGES.find((candidate) => candidate.slug === 'play');
    if (!page) throw new Error('play page missing');
    const markdown = renderLearnMarkdownSource(page);
    // Every link target is fetchable from the .md URL: absolute, site-rooted
    // (resolves against the origin), or an in-page anchor. Nothing that would
    // have resolved against docs/authoring/ survives.
    for (const [, href] of markdown.matchAll(/\]\(([^)\s]+)[^)]*\)/gu)) {
      expect(/^(?:https?:\/\/|\/|#)/u.test(href)).toBe(true);
    }
  });

  test('the artifacts include one markdown sibling per page', () => {
    const artifacts = buildLearnArtifacts();
    expect(artifacts.size).toBe(LEARN_PAGES.length * 2);
    for (const page of LEARN_PAGES) {
      const markdown = artifacts.get(
        `public/${learnMarkdownPath(page).replace(/^\//u, '')}`,
      );
      expect(markdown?.startsWith('---\n')).toBe(true);
    }
  });
});
