/**
 * Scaffolds a pull-request description from the branch's diff, and checks a
 * finished one against the same rules CI applies.
 *
 * Every PR needs a body that says what changed and how it was verified, and
 * writing the template's sections by hand is the same rote work each time.
 * This prints a body with the facts it can know — the changed tests and docs,
 * the template's checklists — and leaves `TODO:` markers for the parts only the
 * author can supply. It never ticks a checklist box: a tick is a claim that a
 * check was run, and this script has not run it.
 *
 * `--check` applies the two rules of the "Validate PR description" job in
 * .github/workflows/pr-automation.yml (not empty, and says how it was verified)
 * plus one local rule: no `TODO:` left behind. The two CI rules are mirrored
 * here, so if that workflow's patterns change, change them here too.
 *
 * Usage:
 *   bun run pr:body                          # scaffold for HEAD vs origin/main
 *   bun run pr:body -- --base origin/develop
 *   bun run pr:body -- --footer "🤖 Generated with …"   # appended verbatim
 *   bun run pr:body -- --check body.md       # validate a finished body ('-' = stdin)
 */
import {
  resolveConfig,
  runCli,
  type ScaffoldInput,
  buildPrBody as scaffold,
} from 'agent-ergonomics';
import stimsConfig from '../agent-ergonomics.config.ts';

export { type ScaffoldInput, validatePrBody } from 'agent-ergonomics';

const config = resolveConfig(stimsConfig);
export const buildPrBody = (input: ScaffoldInput) =>
  scaffold(input, config.prBody);

if (import.meta.main)
  process.exit(await runCli(['pr-body', ...process.argv.slice(2)]));
