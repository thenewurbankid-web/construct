// #348 -- PROOF that a generated spec actually runs under Playwright, against a STATIC html fixture
// (a tiny node:http file server; no Next/Vite dev server), and that a missing data-testid fails as a
// HARNESS problem (naming the convention and the exact expected attribute), not "element not found".
//
// Opt-in (needs Chromium + @playwright/test, which live under ui/e2e/node_modules):
//   CONSTRUCT_RUN_PLAYWRIGHT=1 tools/dev/heavy.sh node --test test/testGeneratorPlaywright.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { generateFeatureTests } from '../src/engine/testGenerator.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW_MODULES = path.join(REPO, 'ui', 'e2e', 'node_modules');
const enabled = process.env.CONSTRUCT_RUN_PLAYWRIGHT === '1' && fs.existsSync(path.join(PW_MODULES, '@playwright', 'test', 'cli.js'));

const MACHINE = `import { setup } from 'xstate';
export const Jobs = setup({}).createMachine({
  id: 'jobs',
  initial: 'idle',
  states: {
    idle: { on: { START_JOB: 'working' } },
    working: { on: { finishJob: 'done' } },
    done: { type: 'final' },
  },
});
`;

const page = ({ finish }) => `<!doctype html><html><body>
<main data-flow="jobs" data-flow-state="idle">
  <button data-testid="start-job" onclick="go('working')">Start</button>
  ${finish ? '<button data-testid="finish-job" onclick="go(\'done\')">Finish</button>' : '<button onclick="go(\'done\')">Finish</button>'}
</main>
<script>function go(s){document.querySelector('[data-flow]').setAttribute('data-flow-state', s)}</script>
</body></html>`;

function buildProject() {
  const dir = makeTempDir('construct-testgen-pw-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\nfrozen:\n  - features/*/tests/generated/**\nnonLayer:\n  - features/*/tests/**\n');
  for (const l of ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components']) fs.mkdirSync(path.join(dir, 'features', 'jobs', l), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'types.ts'), 'export type Id = string;\n');
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'index.ts'), "export type * from './types';\n");
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'workflows', 'Jobs.ts'), MACHINE);
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'controllers', 'JobsController.tsx'), 'export function JobsController() {\n  return <div />;\n}\n');
  fs.mkdirSync(path.join(dir, 'app', 'jobs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app', 'jobs', 'page.tsx'), "import { JobsController } from '../../features/jobs/controllers/JobsController';\n\nexport default function Page() {\n  return <JobsController />;\n}\n");
  return dir;
}

async function runSpec(specText, html) {
  const work = makeTempDir('construct-testgen-pw-run-');
  fs.writeFileSync(path.join(work, 'jobs.spec.ts'), specText);
  const server = http.createServer((req, res) => {
    if (req.url === '/jobs') { res.setHeader('content-type', 'text/html'); res.end(html); } else { res.statusCode = 404; res.end('not found'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(path.join(work, 'playwright.config.cjs'), `module.exports = { testDir: '.', workers: 1, retries: 0, reporter: 'line', timeout: 30000, use: { baseURL: ${JSON.stringify(baseURL)}, headless: true } };\n`);
  const out = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(PW_MODULES, '@playwright', 'test', 'cli.js'), 'test', '--config', path.join(work, 'playwright.config.cjs')], {
      cwd: work, env: { ...process.env, NODE_PATH: PW_MODULES, FORCE_COLOR: '0' },
    });
    let text = '';
    child.stdout.on('data', (d) => { text += d; });
    child.stderr.on('data', (d) => { text += d; });
    child.on('close', (code) => resolve({ code, text }));
  });
  server.close();
  return out;
}

test('generated spec PASSES against a static fixture carrying the convention attributes', { skip: !enabled && 'set CONSTRUCT_RUN_PLAYWRIGHT=1 (needs ui/e2e node_modules + chromium)', timeout: 120000 }, async () => {
  const dir = buildProject();
  const r = generateFeatureTests(dir, 'jobs');
  const spec = fs.readFileSync(path.join(dir, r.written[0]), 'utf8');
  const { code, text } = await runSpec(spec, page({ finish: true }));
  console.log(text);
  assert.equal(code, 0, text);
  assert.match(text, /1 passed/);
});

test('a MISSING data-testid fails as a harness problem naming the convention and the exact attribute', { skip: !enabled && 'set CONSTRUCT_RUN_PLAYWRIGHT=1 (needs ui/e2e node_modules + chromium)', timeout: 120000 }, async () => {
  const dir = buildProject();
  const r = generateFeatureTests(dir, 'jobs');
  const spec = fs.readFileSync(path.join(dir, r.written[0]), 'utf8');
  const { code, text } = await runSpec(spec, page({ finish: false }));
  console.log(text);
  assert.notEqual(code, 0);
  assert.match(text, /Test harness problem, not a bug in the page: the test harness expected \[data-testid="finish-job"\]/);
  assert.match(text, /data-testid = the event name in kebab-case/);
  assert.match(text, /do not file a product bug for this/);
  assert.doesNotMatch(text, /waiting for locator/, 'not a bare "element not found"');
});
