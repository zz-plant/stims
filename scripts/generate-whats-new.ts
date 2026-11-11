#!/usr/bin/env bun
/**
 * Generates the public /whats-new/ page: a reverse-chronological feed of
 * what changed, the screenshots that show it, and a visible measure of how
 * fast the project is moving.
 *
 * Two inputs, so the page stays honest without daily hand-editing:
 *
 *  - `CHANGELOG.md` (Keep a Changelog) is the source of truth for what
 *    shipped and when. Parsing it means the feed cannot drift from the
 *    changelog the release process already maintains.
 *  - `docs/updates/*.md` is the curated overlay: a screenshot and a
 *    plain-English "why it matters" for the handful of changes worth a
 *    picture. Entries are optional; the feed renders without them.
 *
 * Activity is computed from the changelog's release dates (releases per
 * quarter, latest release, changes still in the Unreleased section) rather
 * than git, so it survives a shallow CI checkout.
 *
 *   bun run generate:whats-new            # write public/whats-new/**
 *   bun run generate:whats-new -- --check # fail if the files are stale
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  organizationNode,
  serializeJsonLd,
  websiteNode,
} from '../functions/shared/structured-data.ts';
import { renderStaticPage, type StaticPage } from './generate-learn-pages.ts';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const BASE_URL = 'https://toil.fyi';
const OUTPUT_DIR = 'public/whats-new';
const OUTPUT_HTML = `${OUTPUT_DIR}/index.html`;
const OUTPUT_MARKDOWN = 'public/whats-new.md';
const CHANGELOG_PATH = 'CHANGELOG.md';
const UPDATES_DIR = 'docs/updates';
const _SCREENSHOTS_DIR = 'public/screenshots/whats-new';

const escapeHtml = (value: string) =>
  value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');

type ChangeSection = { heading: string; items: string[] };
type Release = {
  version: string;
  date: string | null;
  unreleased: boolean;
  sections: ChangeSection[];
};

type Highlight = {
  title: string;
  date: string;
  screenshot: string | null;
  blurb: string;
  link: string | null;
};

/** Split a Keep-a-Changelog file into releases, newest first. */
export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  let current: Release | null = null;
  let section: ChangeSection | null = null;

  for (const rawLine of markdown.split(/\r?\n/u)) {
    const line = rawLine.trimEnd();
    const releaseMatch =
      /^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/u.exec(line);
    if (releaseMatch) {
      current = {
        version: releaseMatch[1] ?? 'Unreleased',
        date: releaseMatch[2] ?? null,
        unreleased: (releaseMatch[1] ?? '').toLowerCase() === 'unreleased',
        sections: [],
      };
      section = null;
      releases.push(current);
      continue;
    }
    if (!current) continue;
    const sectionMatch = /^###\s+(.+)$/u.exec(line);
    if (sectionMatch) {
      section = { heading: (sectionMatch[1] ?? '').trim(), items: [] };
      current.sections.push(section);
      continue;
    }
    const itemMatch = /^-\s+(.+)$/u.exec(line);
    if (itemMatch && section) {
      section.items.push((itemMatch[1] ?? '').trim());
    }
  }
  return releases;
}

function parseFrontmatter(raw: string): {
  data: Record<string, string>;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(raw);
  if (!match) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  for (const line of (match[1] ?? '').split(/\r?\n/u)) {
    const entry = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line);
    if (!entry) continue;
    let value = (entry[2] ?? '').trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\"/gu, '"').replace(/\\\\/gu, '\\');
    data[entry[1] ?? ''] = value;
  }
  return { data, body: match[2] ?? '' };
}

export function loadHighlights(rootDir: string): Highlight[] {
  const dir = path.join(rootDir, UPDATES_DIR);
  if (!fs.existsSync(dir)) return [];
  const highlights: Highlight[] = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.md')) continue;
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const title = data.title?.trim();
    const date = data.date?.trim();
    if (!title || !date) continue;
    const screenshotPath = data.screenshot?.trim() ?? '';
    // The frontmatter carries a public URL path (`/screenshots/...`), which
    // lives under public/ in the repo.
    const screenshot =
      screenshotPath &&
      fs.existsSync(
        path.join(rootDir, 'public', screenshotPath.replace(/^\//u, '')),
      )
        ? screenshotPath
        : null;
    highlights.push({
      title,
      date,
      screenshot,
      blurb: (data.blurb ?? body.trim()).trim(),
      link: data.link?.trim() || null,
    });
  }
  return highlights.sort((a, b) => b.date.localeCompare(a.date));
}

type QuarterCount = { label: string; count: number };

export type Activity = {
  totalReleases: number;
  latestVersion: string | null;
  latestDate: string | null;
  inProgress: number;
  firstDate: string | null;
  quarters: QuarterCount[];
};

function quarterOf(date: string): string {
  const year = date.slice(0, 4);
  const month = Number(date.slice(5, 7));
  return `${year} Q${Math.floor((month - 1) / 3) + 1}`;
}

export function computeActivity(releases: Release[]): Activity {
  const dated = releases.filter(
    (release) => !release.unreleased && release.date,
  );
  const quarters = new Map<string, number>();
  for (const release of dated) {
    const quarter = quarterOf(release.date as string);
    quarters.set(quarter, (quarters.get(quarter) ?? 0) + 1);
  }
  const sortedQuarters = [...quarters.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8)
    .map(([label, count]) => ({ label, count }));
  const unreleased = releases.find((release) => release.unreleased);
  const inProgress =
    unreleased?.sections.reduce(
      (total, section) => total + section.items.length,
      0,
    ) ?? 0;
  const latest = dated[0] ?? null;
  const oldest = dated[dated.length - 1] ?? null;
  return {
    totalReleases: dated.length,
    latestVersion: latest?.version ?? null,
    latestDate: latest?.date ?? null,
    inProgress,
    firstDate: oldest?.date ?? null,
    quarters: sortedQuarters,
  };
}

function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function renderActivity(activity: Activity): string {
  const cards = [
    `${activity.totalReleases} releases${activity.firstDate ? ` since ${escapeHtml(activity.firstDate.slice(0, 4))}` : ''}`,
    activity.latestVersion
      ? `latest v${escapeHtml(activity.latestVersion)}${activity.latestDate ? ` on ${escapeHtml(formatDate(activity.latestDate))}` : ''}`
      : 'first release pending',
    `${activity.inProgress} changes in progress`,
  ];
  const maxCount = Math.max(1, ...activity.quarters.map((q) => q.count));
  const bars = activity.quarters
    .map(
      (quarter) =>
        `<li class="wn-bar" title="${escapeHtml(quarter.label)}: ${quarter.count}">
<span class="wn-bar__fill" style="height:${Math.round((quarter.count / maxCount) * 100)}%"></span>
<span class="wn-bar__label">${escapeHtml(quarter.label.replace(/^\d{2}(\d{2})\s(Q\d)$/u, '$2 ’$1'))}</span>
</li>`,
    )
    .join('');
  return `<section class="wn-activity" aria-label="How actively Stims is improved">
<div class="wn-stats">
${cards.map((card) => `<p class="wn-stat">${card}</p>`).join('\n')}
</div>
<figure class="wn-chart">
<figcaption>Releases per quarter</figcaption>
<ol class="wn-bars">${bars}</ol>
</figure>
</section>`;
}

function renderHighlights(highlights: Highlight[]): string {
  if (highlights.length === 0) return '';
  const cards = highlights
    .map((highlight) => {
      const image = highlight.screenshot
        ? `<img src="${escapeHtml(highlight.screenshot)}" alt="${escapeHtml(highlight.title)}" loading="lazy" width="1200" height="750" />`
        : '';
      const link = highlight.link
        ? `<a class="wn-card__link" href="${escapeHtml(highlight.link)}">Try it</a>`
        : '';
      return `<article class="wn-card">
${image}
<div class="wn-card__body">
<h3 class="wn-card__title">${escapeHtml(highlight.title)}</h3>
<time class="wn-card__date" datetime="${escapeHtml(highlight.date)}">${escapeHtml(formatDate(highlight.date))}</time>
<p>${escapeHtml(highlight.blurb)}</p>
${link}
</div>
</article>`;
    })
    .join('\n');
  return `<section aria-labelledby="wn-highlights">
<h2 id="wn-highlights">Highlights</h2>
<div class="wn-cards">${cards}</div>
</section>`;
}

const SECTION_ORDER = ['Added', 'Changed', 'Removed', 'Fixed', 'Security'];

function renderRelease(release: Release, expanded: boolean): string {
  if (release.sections.length === 0) return '';
  const summary = release.unreleased
    ? 'In progress'
    : `${release.date ? formatDate(release.date) : 'Undated'}`;
  const body = release.sections
    .slice()
    .sort(
      (a, b) =>
        SECTION_ORDER.indexOf(a.heading) - SECTION_ORDER.indexOf(b.heading),
    )
    .map(
      (section) =>
        `<h4>${escapeHtml(section.heading)}</h4>\n<ul>${section.items
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join('\n')}</ul>`,
    )
    .join('\n');
  const heading = release.unreleased
    ? 'Unreleased'
    : `v${escapeHtml(release.version)}`;
  return `<details${expanded ? ' open' : ''}>
<summary><span class="wn-release__version">${heading}</span> <span class="wn-release__date">${escapeHtml(summary)}</span></summary>
${body}
</details>`;
}

export function buildWhatsNewArtifacts(
  rootDir: string = repoRoot,
): Map<string, string> {
  const changelog = fs.readFileSync(path.join(rootDir, CHANGELOG_PATH), 'utf8');
  const releases = parseChangelog(changelog);
  const activity = computeActivity(releases);
  const highlights = loadHighlights(rootDir);

  // Only the newest shipped release opens; Unreleased and older releases
  // stay collapsed so the page reads as a highlights page, not a wall of
  // every changelog bullet ever written.
  const firstDatedIndex = releases.findIndex(
    (release) => !release.unreleased && release.sections.length > 0,
  );
  const feed = releases
    .map((release, index) => renderRelease(release, index === firstDatedIndex))
    .join('\n');

  const main = `<h1>What's new in Stims</h1>
<p class="wn-lede">Every notable change, newest first, with pictures of the ones you can see. Stims is built in the open; the changelog below is the same one the release process keeps.</p>
${renderActivity(activity)}
${renderHighlights(highlights)}
<section aria-labelledby="wn-feed">
<h2 id="wn-feed">Full history</h2>
${feed}
</section>
<p class="wn-source">The raw history lives in <a href="https://github.com/zz-plant/stims/blob/main/CHANGELOG.md">CHANGELOG.md</a>. Planned work is in the <a href="https://github.com/zz-plant/stims/blob/main/docs/ROADMAP.md">roadmap</a>.</p>`;

  const url = `${BASE_URL}/whats-new/`;
  const jsonLd = serializeJsonLd({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${url}#page`,
        name: "What's new in Stims",
        headline: "What's new in Stims",
        description:
          'Recent changes to Stims, with screenshots, plus how actively the project is being improved.',
        url,
        inLanguage: 'en',
      },
      websiteNode(BASE_URL),
      organizationNode(BASE_URL),
    ],
  });

  const extraStyle = `
.wn-lede{color:var(--muted);max-width:42rem}
.wn-activity{display:grid;gap:16px;margin:1.5em 0 2em;padding:16px 18px;border:1px solid var(--line);border-radius:6px;background:var(--code)}
@media(min-width:640px){.wn-activity{grid-template-columns:1fr auto;align-items:end}}
.wn-stats{display:grid;gap:6px}
.wn-stat{margin:0;font-weight:600;font-size:1.05rem}
.wn-stat:before{content:"";display:inline-block;width:7px;height:7px;margin-right:9px;border-radius:50%;border:1px solid var(--muted);vertical-align:middle}
.wn-chart{margin:0}
.wn-chart figcaption{color:var(--muted);font-size:.8rem;margin-bottom:6px}
.wn-bars{display:flex;align-items:flex-end;gap:6px;height:64px;margin:0;padding:0;list-style:none}
.wn-bar{display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;min-width:22px;flex:1}
.wn-bar__fill{width:100%;max-width:18px;background:var(--muted);min-height:2px}
.wn-bar__label{font-size:.62rem;color:var(--muted);margin-top:4px}
.wn-cards{display:grid;gap:18px;margin:1.2em 0}
@media(min-width:640px){.wn-cards{grid-template-columns:1fr 1fr}}
.wn-card{border:1px solid var(--line);border-radius:6px;overflow:hidden;background:var(--code)}
.wn-card img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;border-bottom:1px solid var(--line)}
.wn-card__body{padding:14px 16px}
.wn-card__title{margin:0 0 2px;font-size:1.1rem}
.wn-card__date{color:var(--muted);font-size:.8rem}
.wn-card p{margin:.5em 0 .6em}
.wn-card__link{font-weight:600;text-decoration:none}
details{margin:.8em 0;border:1px solid var(--line);border-radius:6px;padding:2px 16px 6px;background:var(--zebra)}
summary{cursor:pointer;padding:8px 0;font-weight:600}
.wn-release__date{color:var(--muted);font-weight:400;font-size:.9rem;margin-left:8px}
details h4{margin:1em 0 .3em;font-size:.95rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
details ul{margin:.2em 0 .8em;padding-left:1.3em}
.wn-source{color:var(--muted);font-size:.9rem;margin-top:2em}
`;

  const page: StaticPage = {
    title: "What's new in Stims — Recent Changes | Stims",
    description:
      'Recent changes to Stims, with screenshots, plus releases per quarter and what is being worked on now.',
    url,
    ogType: 'website',
    jsonLd,
    main,
    extraStyle,
    alternateMarkdown: {
      href: `${BASE_URL}/whats-new.md`,
      title: "What's new in Stims — Markdown source",
    },
  };

  const markdown = renderWhatsNewMarkdown(releases, activity, highlights);

  return new Map([
    [OUTPUT_HTML, renderStaticPage(page)],
    [OUTPUT_MARKDOWN, markdown],
  ]);
}

function renderWhatsNewMarkdown(
  releases: Release[],
  activity: Activity,
  highlights: Highlight[],
): string {
  const lines: string[] = [
    '---',
    'title: "What\'s new in Stims"',
    'description: "Recent changes to Stims, with screenshots, plus how actively the project is being improved."',
    `url: ${BASE_URL}/whats-new/`,
    `source: https://github.com/zz-plant/stims/blob/main/${CHANGELOG_PATH}`,
    '---',
    '',
    "# What's new in Stims",
    '',
    `${activity.totalReleases} releases${activity.firstDate ? ` since ${activity.firstDate.slice(0, 4)}` : ''}. ${activity.latestVersion ? `Latest v${activity.latestVersion}${activity.latestDate ? ` on ${activity.latestDate}` : ''}.` : ''} ${activity.inProgress} changes in progress.`,
    '',
  ];
  if (highlights.length > 0) {
    lines.push('## Highlights', '');
    for (const highlight of highlights) {
      lines.push(`### ${highlight.title} (${highlight.date})`, '');
      if (highlight.screenshot) {
        lines.push(
          `![${highlight.title}](${BASE_URL}${highlight.screenshot})`,
          '',
        );
      }
      lines.push(highlight.blurb, '');
      if (highlight.link) lines.push(`[Try it](${highlight.link})`, '');
    }
  }
  lines.push('## Full history', '');
  for (const release of releases) {
    if (release.sections.length === 0) continue;
    lines.push(
      `### ${release.unreleased ? 'Unreleased' : `v${release.version}`}${release.date ? ` — ${release.date}` : ''}`,
      '',
    );
    for (const section of release.sections) {
      lines.push(`#### ${section.heading}`, '');
      for (const item of section.items) lines.push(`- ${item}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

export function findStaleWhatsNewFiles(rootDir: string = repoRoot): string[] {
  const stale: string[] = [];
  for (const [file, contents] of buildWhatsNewArtifacts(rootDir)) {
    const full = path.join(rootDir, file);
    if (!fs.existsSync(full) || fs.readFileSync(full, 'utf8') !== contents) {
      stale.push(file);
    }
  }
  return stale;
}

function main() {
  if (process.argv.includes('--check')) {
    const stale = findStaleWhatsNewFiles();
    if (stale.length > 0) {
      console.error(
        `What's new is stale (${stale.join(', ')}).\nRun: bun run generate:whats-new`,
      );
      process.exit(1);
    }
    console.log("✔ What's new page and markdown are current");
    return;
  }
  for (const [file, contents] of buildWhatsNewArtifacts()) {
    const full = path.join(repoRoot, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  console.log(`Wrote ${OUTPUT_HTML} and ${OUTPUT_MARKDOWN}`);
}

if (import.meta.main) main();
