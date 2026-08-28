/**
 * Keep the agent skill set discoverable and well-formed.
 *
 * Skills are how repeatable work classes are handed to agents, but an agent
 * only ever finds a skill through an index: the capability table in
 * `docs/agents/custom-capabilities.md` and the routing table in
 * `.claude/CLAUDE.md`. Both are maintained by hand, so a skill added without
 * an index row is invisible — the work class it encodes gets re-derived from
 * scratch every time, which is the exact cost skills exist to remove.
 *
 * `check-doc-references.ts` verifies that links in the docs point at files
 * that exist. This is the other direction: that files which exist are
 * reachable from the docs.
 *
 * Checks per `.agent/skills/<dir>/SKILL.md`:
 *   1. YAML frontmatter with `name` and a non-trivial `description`
 *   2. `name` matches the directory (routing tables address skills by path,
 *      and a mismatch makes the two ways of naming a skill disagree)
 *   3. the skill is listed in the capability index
 *
 * The `.claude/CLAUDE.md` routing table is deliberately a shortlist — it says
 * so — and is not required to carry every skill.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SKILLS_ROOT = '.agent/skills';
const CAPABILITY_INDEX = 'docs/agents/custom-capabilities.md';
/** Long enough to say when the skill applies, not just restate its name. */
const MIN_DESCRIPTION_LENGTH = 40;

const offenders: string[] = [];

const capabilityIndex = existsSync(CAPABILITY_INDEX)
  ? readFileSync(CAPABILITY_INDEX, 'utf8')
  : '';
if (!capabilityIndex) {
  console.error(`✖ Missing capability index: ${CAPABILITY_INDEX}`);
  process.exit(1);
}

const skillDirs = readdirSync(SKILLS_ROOT).filter((entry) =>
  statSync(join(SKILLS_ROOT, entry)).isDirectory(),
);

for (const dir of skillDirs) {
  const skillPath = join(SKILLS_ROOT, dir, 'SKILL.md');
  if (!existsSync(skillPath)) {
    offenders.push(`${dir}/ has no SKILL.md`);
    continue;
  }

  const source = readFileSync(skillPath, 'utf8');
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) {
    offenders.push(`${dir}/SKILL.md has no YAML frontmatter block`);
    continue;
  }

  const name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = frontmatter[1]
    .match(/^description:\s*(.+)$/m)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, '');

  if (!name) {
    offenders.push(`${dir}/SKILL.md frontmatter has no \`name\``);
  } else if (name !== dir) {
    offenders.push(
      `${dir}/SKILL.md declares \`name: ${name}\` but lives in \`${dir}/\` — routing tables address skills by directory`,
    );
  }

  if (!description) {
    offenders.push(`${dir}/SKILL.md frontmatter has no \`description\``);
  } else if (description.length < MIN_DESCRIPTION_LENGTH) {
    offenders.push(
      `${dir}/SKILL.md description is too short to route on (${description.length} chars): "${description}"`,
    );
  }

  if (!capabilityIndex.includes(`${SKILLS_ROOT}/${dir}/SKILL.md`)) {
    offenders.push(
      `${dir} is not listed in ${CAPABILITY_INDEX} — agents will never find it`,
    );
  }
}

if (offenders.length > 0) {
  console.error(`✖ Found ${offenders.length} skill index problem(s):\n`);
  for (const offender of offenders) console.error(`  ${offender}`);
  console.error(
    `\nAdd a row to ${CAPABILITY_INDEX} for a new skill, and consider ` +
      `.claude/CLAUDE.md's routing table when it covers a common task class.`,
  );
  process.exit(1);
}

console.log(
  `✔ ${skillDirs.length} agent skills are well-formed and listed in the capability index`,
);
