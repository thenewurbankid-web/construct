## The core test suite

```bash
npm install
npm test
```

`npm test` runs `node --test`, which picks up the suites in `test/` (rules, generators, AST, pipeline, import, CLI, workflows, and more) and the documentation-site tests in `site/test/`. Most tests build a real project in a temporary directory, run the real CLI or module against it and assert on files and exit codes; fixture projects live in `fixtures/`.

One suite talks to a real local model and is skipped unless you opt in:

```bash
CONSTRUCT_TEST_LIVE_OLLAMA=1 npm test
```

It needs an Ollama server at `http://localhost:11434` with `qwen2.5-coder:0.5b` pulled.

Other useful checks:

```bash
npm run build       # tsc --noEmit
npm run lint        # eslint
```

## The Cockpit backend

```bash
cd ui/server && npm install && npm test
```

## Browser tests

The Cockpit is covered by Playwright tests in `ui/e2e/`:

```bash
cd ui/e2e && npm install && npm run install-browsers && npm test
```

The backend accepts requests only from `UI_CLIENT_ORIGIN` (default `http://localhost:3000`). If your run serves the frontend on another port, set that variable for the backend.

## The documentation site

```bash
node --test site/test/*.test.mjs
node site/build.mjs --out site/dist
```

The site is generated from the repository's own docs plus authored example pages, so a broken include or link fails the build. The build needs no network and no token.

## Writing tests

- Put a test next to the behaviour it protects, using `node:test` and `node:assert/strict`.
- Prefer a fixture project over mocking: the point of these tools is what they do to real files.
- For a new rule, add one project that violates it and one that does not.
- Never make a test depend on a hosted model. Live-model tests are opt-in like the one above.
