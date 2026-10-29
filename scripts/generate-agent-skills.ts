/**
 * Writes /.well-known/agent-skills/index.json from the SKILL.md files under
 * public/.well-known/agent-skills/<name>/.
 *
 * Each skill becomes one index entry with its frontmatter description and the
 * sha256 digest of the file's bytes, per the Agent Skills discovery draft
 * (Cloudflare RFC; index schema 0.2.0 at schemas.agentskills.io). Clients hash
 * the downloaded file and refuse it on mismatch, so the digest must be
 * recomputed here every time a skill file changes — hand-editing the index is
 * how digests go stale.
 *
 *   bun run generate:agent-skills            # write the index
 *   bun run generate:agent-skills -- --check # fail if the index has drifted
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const SKILLS_DIR = 'public/.well-known/agent-skills';
export const SKILLS_INDEX_PATH = `${SKILLS_DIR}/index.json`;
const INDEX_SCHEMA =
  'https://schemas.agentskills.io/discovery/0.2.0/schema.json';
const BASE_URL = 'https://toil.fyi';

type Skill = { name: string; description: string };

const skillDirs = () =>
  fs
    .readdirSync(path.join(repoRoot, SKILLS_DIR), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

function parseFrontmatter(markdown: string, file: string): Skill {
  const match = /^---\n([\s\S]*?)\n---/u.exec(markdown);
  if (!match) throw new Error(`${file}: missing YAML frontmatter`);
  const block = match[1] ?? '';
  const name = /^name:\s*(.+)$/mu.exec(block)?.[1]?.trim();
  const description = /^description:\s*(.+)$/mu.exec(block)?.[1]?.trim();
  if (!name || !description) {
    throw new Error(`${file}: frontmatter needs name and description`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) || name.length > 64) {
    throw new Error(`${file}: name must be lowercase hyphenated, 1–64 chars`);
  }
  if (description.length > 1024) {
    throw new Error(`${file}: description exceeds 1024 characters`);
  }
  return { name, description };
}

/** The index document as it should exist on disk right now. */
export function buildAgentSkillsIndex(): string {
  const skills = skillDirs().map((dir) => {
    const relative = `${SKILLS_DIR}/${dir}/SKILL.md`;
    const bytes = fs.readFileSync(path.join(repoRoot, relative));
    const { name, description } = parseFrontmatter(
      bytes.toString('utf8'),
      relative,
    );
    if (name !== dir) {
      throw new Error(
        `${relative}: frontmatter name ${name} != directory ${dir}`,
      );
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    return {
      name,
      type: 'skill-md',
      description,
      // Site URL, not the repo path — drop the public/ build prefix.
      url: `${BASE_URL}/${relative.replace(/^public\//u, '')}`,
      digest: `sha256:${digest}`,
    };
  });
  return `${JSON.stringify({ $schema: INDEX_SCHEMA, skills }, null, 2)}\n`;
}

function main() {
  const index = buildAgentSkillsIndex();
  if (process.argv.includes('--check')) {
    let existing: string | null = null;
    try {
      existing = fs.readFileSync(
        path.join(repoRoot, SKILLS_INDEX_PATH),
        'utf8',
      );
    } catch {
      existing = null;
    }
    if (existing !== index) {
      console.error(
        `Agent Skills index is stale — run: bun run generate:agent-skills`,
      );
      process.exit(1);
    }
    console.log('✔ Agent Skills index is current');
    return;
  }
  const full = path.join(repoRoot, SKILLS_INDEX_PATH);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, index);
  console.log(`Wrote ${SKILLS_INDEX_PATH}`);
}

if (import.meta.main) main();
