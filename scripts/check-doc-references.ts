/**
 * Guard against docs that point at files and commands which no longer exist.
 *
 * `check-stale-paths.ts` catches one specific migration (`assets/` → `src/`).
 * This guard is the general case: a doc that names `tests/foo.test.ts` after
 * the file moved to `tests/unit/`, or tells an agent to run
 * `bun run test:legacy-frontend` after that script was deleted, sends the
 * reader somewhere that does not exist. Agents follow `AGENTS.md` and the
 * skills literally, so a dangling reference costs a failed command and a
 * wrong mental model of the tree.
 *
 * Every file an agent tool reads as instructions is scanned, not only
 * `docs/`: `.claude/` (CLAUDE.md and the auto-loaded skills), the Markdown
 * under `.github/` (Copilot instructions and prompt files, the PR template,
 * `.github/AGENTS.md`), and `.opencode/` commands and modes. The opencode
 * commands once ran `bun run qa` and `bun run deploy`, neither of which
 * existed, because nothing checked that directory.
 *
 * Two reference kinds are checked:
 *   - repo paths (`src/…`, `tests/…`, `scripts/…`, `.claude/…`, …) in
 *     backticks or links
 *   - `bun run <script>` invocations, checked against package.json
 *
 * Exemptions, all deliberate:
 *   - historical records (audits, critiques, dated status docs, `docs/archive`,
 *     `docs/evidence`) describe a tree as it was; rewriting them would
 *     misrepresent the record
 *   - glob-ish references (`renderer-adapter*.ts`, `compiler/**`) — only the
 *     literal directory prefix is verified
 *   - documented placeholders (`tests/path/to/spec.test.ts`) and proposal docs
 *     that name files a plan would create (marked `(NEW)` or "New follow-up")
 *   - generated docs (`docs/GUARDRAILS.md`), whose prose is copied verbatim
 *     from guard docblocks. Those docblocks cite illustrative non-existent
 *     paths on purpose — `check-doc-references.ts` itself names
 *     `tests/foo.test.ts` to explain what it catches. The references are
 *     already verified where they are authored, in `scripts/`, so checking the
 *     copy would force the explanations to be written worse.
 */
import { runCli } from 'agent-ergonomics';

if (import.meta.main)
  process.exit(await runCli(['doc-refs', ...process.argv.slice(2)]));
