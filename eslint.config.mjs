// Construct's semantic validator is authoritative for architecture. Add your normal ESLint rules here.

// #335: every temp directory in tests must come from test-utils/tmpdir.mjs (`makeTempDir`).
// #254 leaked 58k directories (~1.1 GB of RAM-backed /tmp on a 15 GB no-swap box) because
// tests called `mkdtempSync(os.tmpdir())` directly and only cleaned up on the happy path.
const TMPDIR_MESSAGE =
  'Do not create temp directories with mkdtemp/mkdtempSync(os.tmpdir()) here. Use makeTempDir() from ' +
  'test-utils/tmpdir.mjs: it creates the directory under one per-process root that is removed on exit, ' +
  'throw, SIGINT or SIGTERM, so a failed assertion cannot leak RAM-backed /tmp (#254, #335).';

// A call to mkdtemp / mkdtempSync (bare, or a member call such as fs.mkdtempSync or fs.promises.mkdtemp)
// whose arguments mention a tmpdir() call anywhere: os.tmpdir(), tmpdir(), path.join(os.tmpdir(), ...),
// os.tmpdir() + '/x', a template literal.
const TMPDIR_ARG = ':has(CallExpression[callee.name="tmpdir"], CallExpression[callee.property.name="tmpdir"])';

export const noBareTmpdir = {
  selector:
    `CallExpression[callee.name=/^mkdtemp(Sync)?$/]${TMPDIR_ARG}, ` +
    `CallExpression[callee.property.name=/^mkdtemp(Sync)?$/]${TMPDIR_ARG}`,
  message: TMPDIR_MESSAGE,
};

export default [
  // `example/` is a separate Next.js project with its own eslint config and dependencies
  // (eslint-config-next) that the root install does not have; ESLint 10 tries to load it and
  // aborts the whole run ("Cannot find package 'eslint-config-next'"). It is linted from its own directory.
  // `.claude/**`: agent worktrees live INSIDE the checkout, each carrying its own eslint.config.mjs; without this
  // ESLint descends into them and aborts ("empty config", missing packages), so `npm run lint` only passed in a
  // clean worktree and failed in the real checkout.
  { ignores: ['.claude/**', 'example/**', '**/node_modules/**', '**/dist/**', 'ui/e2e/test-results/**', 'ui/e2e/playwright-report/**'] },

  // Scope (#335): the places where makeTempDir applies. Deliberately NOT covered:
  //  - packages/engine/*.mjs (gitTrees, transactionalWriter, processEngine) manage their own directory
  //    lifetime as product behaviour and must not depend on a test helper;
  //  - ui/e2e/**/*.spec.js create their own dirs and rmSync them in afterAll (measured: zero leaks);
  //    migrating specs that cannot be run in a worktree risks drift (the #254 codemod wrote imports
  //    into fixture template literals). Revisit once the Playwright suite is runnable.
  {
    files: ['test/**/*.mjs', 'site/test/**/*.mjs', 'ui/server/src/**/*.test.mjs'],
    rules: { 'no-restricted-syntax': ['error', noBareTmpdir] },
  },
];
