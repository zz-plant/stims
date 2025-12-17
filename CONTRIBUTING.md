# Contributing to Stim Webtoys Library

Thanks for helping build and refine the Stim Webtoys Library! This guide covers the basics for setting up your environment, running the project, and adding or updating toys.

## Environment Setup

- Use **Node.js 22** (see `.nvmrc`). If you use nvm, run `nvm use` after cloning.
- Install dependencies with:
  ```bash
  npm install
  ```

## Running the Dev Server

Start the local development server and open the site at `http://localhost:5173`:
```bash
npm run dev
```

## Testing, Linting, and Formatting

- Run all tests:
  ```bash
  npm test
  ```
- Run Jest directly with filters (for example, targeting specific files):
  ```bash
  npm run jest -- --testPathPattern=path/to/spec
  ```
- Lint the project:
  ```bash
  npm run lint
  ```
- Format the codebase:
  ```bash
  npm run format
  ```

## Branching and Pull Requests

- Start from the latest `main` branch and create a feature branch for your work.
- Keep changes focused and prefer smaller, reviewable pull requests.
- Run tests and linting before opening a PR.
- Provide a clear description of what changed and any testing performed.

## Adding or Updating Webtoys

- Core toy implementations live in `assets/js/toys/` (e.g., `assets/js/toys/cube-wave.ts`). Add new toy modules there and reuse helpers from `assets/js/core/` or `assets/js/utils/` when possible.
- Register toy metadata (labels, slugs, and settings) in `assets/js/toys-data.js` so the loader can find your new toy.
- Toy entry points are served through `toy.html` using a `?toy=` query string (for example, `toy.html?toy=cube-wave`). Ensure your toy slug matches the metadata entry.
- Shared styling and assets live under `assets/css/` and `assets/data/`. Add new static assets there when needed.
- Update or add tests under `tests/` to cover new behaviors. You can run targeted checks with the `--testPathPattern` flag shown above.

Happy building!
