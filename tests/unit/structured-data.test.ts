import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applicationId,
  MILKDROP_ENTITY,
  MUSIC_VISUALIZATION_ENTITY,
  organizationId,
  organizationNode,
  serializeJsonLd,
  websiteId,
} from '../../functions/shared/structured-data.ts';
import {
  buildLearnArtifacts,
  LEARN_PAGES,
  learnPagePath,
} from '../../scripts/generate-learn-pages.ts';

type Node = Record<string, unknown>;

const ORIGIN = 'https://toil.fyi';

const jsonLdBlocks = (html: string): Node[] =>
  [
    ...html.matchAll(
      /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/gu,
    ),
  ].map((match) => JSON.parse(match[1] as string) as Node);

const learnGraph = (html: string) =>
  (jsonLdBlocks(html)[0]?.['@graph'] ?? []) as Node[];

describe('the home page entities', () => {
  const blocks = jsonLdBlocks(
    readFileSync(join(import.meta.dir, '../../index.html'), 'utf8'),
  );
  const site = blocks.find((node) => node['@type'] === 'WebSite') as Node;
  const app = blocks.find(
    (node) => node['@type'] === 'SoftwareApplication',
  ) as Node;

  test('use the ids every other page points at', () => {
    expect(site['@id']).toBe(websiteId(ORIGIN));
    expect(app['@id']).toBe(applicationId(ORIGIN));
    expect(app.isPartOf).toEqual({ '@id': websiteId(ORIGIN) });
    expect(app.publisher).toEqual({ '@id': organizationId(ORIGIN) });
    expect(site.publisher).toEqual(organizationNode(ORIGIN));
  });

  test('name the application, not the page title', () => {
    expect(app.name).toBe('Stims');
  });

  test('identify MilkDrop as the shared entity does', () => {
    expect(app.about).toEqual([MILKDROP_ENTITY, MUSIC_VISUALIZATION_ENTITY]);
  });
});

describe('the learn pages', () => {
  const artifacts = buildLearnArtifacts();
  const page = (slug: string) =>
    artifacts.get(`public/learn/${slug ? `${slug}/` : ''}index.html`) as string;

  test('all join the site graph and say what they are about', () => {
    for (const learnPage of LEARN_PAGES) {
      const main = learnGraph(page(learnPage.slug))[0] as Node;
      expect(JSON.stringify(main.isPartOf)).toContain(websiteId(ORIGIN));
      expect(main.about).toBeDefined();
    }
  });

  test('the hub is a course whose parts are the tracks', () => {
    const course = learnGraph(page('')).find(
      (node) => node['@type'] === 'Course',
    ) as { '@id': string; hasPart: { url: string }[] };
    expect(course.hasPart.map((part) => part.url)).toEqual(
      LEARN_PAGES.filter((item) => item.kind === 'track').map(
        (item) => `${ORIGIN}${learnPagePath(item)}`,
      ),
    );
    const track = learnGraph(page('motion'))[0] as { isPartOf: Node[] };
    expect(track.isPartOf).toContainEqual({ '@id': course['@id'] });
  });

  test('the comparison page names what it compares', () => {
    const main = learnGraph(page('milkdrop-vs-butterchurn-projectm'))[0] as {
      about: { name: string }[];
    };
    expect(main.about.map((entity) => entity.name)).toEqual([
      'MilkDrop',
      'Butterchurn',
      'projectM',
    ]);
  });

  test('the glossary defines the terms its table shows', () => {
    const html = page('technique-glossary');
    const terms = learnGraph(html).find(
      (node) => node['@type'] === 'DefinedTermSet',
    ) as { hasDefinedTerm: { name: string; description: string }[] };
    const names = terms.hasDefinedTerm.map((term) => term.name);
    expect(names).toContain('Jelly');
    expect(names).toContain('Flexi-Tex Shader');
    for (const term of terms.hasDefinedTerm) {
      expect(html).toContain(`<strong>${term.name}</strong>`);
      expect(term.description).not.toContain('<');
      expect(term.description.length).toBeGreaterThan(0);
    }
  });
});

test('serialized JSON-LD cannot close its script element', () => {
  const text = serializeJsonLd({ name: '</script><script>alert(1)</script>' });
  expect(text).not.toContain('<');
  expect(JSON.parse(text).name).toBe('</script><script>alert(1)</script>');
});
