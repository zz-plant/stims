# Contributing to Stim Webtoys Library

Thanks for helping build and refine the Stim Webtoys Library! This guide covers the basics for setting up your environment, running the project, and adding or updating toys.

## Environment Setup

- Use **Bun 1.2+** for installs and test runs (the repo records this in `package.json`).
- Install dependencies (Bun is the only lockfile tracked in git):
  ```bash
  bun install
  ```

  The repository pins installs via `bun.lock`, so use `bun install --frozen-lockfile` to honor it.
  Bun does not automatically run `prepare` scripts, so a `postinstall` script installs Husky when your user agent starts with `bun`. If that misses your setup, run `bun x husky install` after installing dependencies.

## Running the Dev Server

Start the local development server and open the site at `http://localhost:5173`:

```bash
bun run dev
```

## Testing, Linting, and Formatting

- Run all tests:
  ```bash
  bun run test
  ```
  Always invoke the script so the pinned `--preload=./tests/setup.ts` and `--importmap=./tests/importmap.json` flags apply, loading happy-dom globals and a Three.js stub needed for headless specs.
- Run the Bun test runner with filters (for example, targeting specific files):
  ```bash
  bun run test tests/path/to/spec.test.js
  ```
- Lint the project:
  ```bash
  bun run lint
  ```
- Apply lint auto-fixes and formatting:
  ```bash
  bun run lint:fix
  ```
- Format the codebase:
  ```bash
  bun run format
  ```
- Check formatting without writing:
  ```bash
  bun run format:check
  ```
- Run lint, typecheck, and tests together:
  ```bash
  bun run check
  ```

## Branching and Pull Requests

- Start from the latest `main` branch and create a feature branch for your work.
- Keep changes focused and prefer smaller, reviewable pull requests.
- Run tests and linting before opening a PR.
- Provide a clear description of what changed and any testing performed.

## Adding or Updating Webtoys

- Core toy implementations live in `assets/js/toys/` (e.g., `assets/js/toys/cube-wave.ts`). Add new toy modules there and reuse helpers from `assets/js/core/` or `assets/js/utils/` when possible.
- Register toy metadata (labels, slugs, and settings) in `assets/data/toys.json` so the loader can find your new toy.
- Toy entry points are served through `toy.html` using a `?toy=` query string (for example, `toy.html?toy=cube-wave`). Ensure your toy slug matches the metadata entry.
- Shared styling and assets live under `assets/css/` and `assets/data/`. Add new static assets there when needed.
- Update or add tests under `tests/` to cover new behaviors. You can run targeted checks by passing the spec path to `bun run test`.
- Use `bun run scripts/scaffold-toy.ts` to scaffold a new toy: it prompts for slug/title/type, writes a starter module using the playbook template, updates `assets/data/toys.json` and `docs/TOY_SCRIPT_INDEX.md`, and can generate a minimal Bun spec that asserts `start` is exported.

Happy building!
