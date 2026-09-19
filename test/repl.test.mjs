import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, '..', 'bin', 'construct.mjs');

function emptyProjectDir() {
  return makeTempDir('construct-repl-');
}

/** Feed a sequence of REPL lines via stdin and return the full transcript. */
function runRepl(lines, cwd) {
  return spawnSync('node', [bin, 'repl'], {
    encoding: 'utf8',
    cwd: cwd ?? process.cwd(),
    input: lines.join('\n') + '\n',
  });
}

test('repl prints a banner and the top-level help list', () => {
  const res = runRepl(['help', 'exit'], emptyProjectDir());
  assert.match(res.stdout, /Construct REPL/);
  assert.match(res.stdout, /not inside a Construct project yet/);
  assert.match(res.stdout, /Capabilities:/);
  assert.match(res.stdout, /Goodbye\./);
});

test('repl help <topic> prints detailed help for a known topic', () => {
  const res = runRepl(['help refactor', 'exit'], emptyProjectDir());
  assert.match(res.stdout, /refactor move <name> --feature <feature> --from <layer> --to <layer>/);
});

test('repl help <unknown-topic> lists valid topics instead of crashing', () => {
  const res = runRepl(['help bogus', 'exit'], emptyProjectDir());
  assert.match(res.stdout, /No help topic "bogus"/);
  assert.match(res.stdout, /Topics:/);
});

test('repl dispatches create/refactor/research the same as the flat CLI, and cd changes context', () => {
  const dir = emptyProjectDir();
  const res = runRepl(
    [
      'init .',
      'create feature checkout',
      'create layer Foo --feature checkout --layers domain,hook',
      'refactor rename Foo Bar --feature checkout --layer domain',
      'research summarize --feature checkout --format compact',
    ],
    dir,
  );
  assert.match(res.stdout, /Initialized Construct/);
  assert.match(res.stdout, /Created feature checkout/);
  assert.match(res.stdout, /Renamed features\/checkout\/domain\/Foo\.tsx -> features\/checkout\/domain\/Bar\.tsx/);
  assert.match(res.stdout, /Feature "checkout"/);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'domain', 'Bar.tsx')), true);
});

test('repl cd + pwd changes the working directory for subsequent commands', () => {
  const dir = emptyProjectDir();
  fs.mkdirSync(path.join(dir, 'nested'));
  const res = runRepl(['cd nested', 'pwd'], dir);
  assert.match(res.stdout, new RegExp(path.join(dir, 'nested').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('repl reports an unknown command without crashing the session', () => {
  const res = runRepl(['bogus-command', 'pwd'], emptyProjectDir());
  assert.match(res.stdout, /Unknown command "bogus-command"/);
  // The session kept going after the unknown command — pwd still ran.
  assert.match(res.stdout, /construct>/);
});

test('repl surfaces a ConstructError (on stderr) without crashing the session', () => {
  const res = runRepl(['generate', 'pwd', 'exit'], emptyProjectDir());
  assert.match(res.stderr, /Construct error: Usage: construct generate/);
  assert.match(res.stdout, /Goodbye\./);
});

test('repl runs import and shows a "Next" hint pointing at the source file', () => {
  const dir = emptyProjectDir();
  fs.writeFileSync(path.join(dir, 'OldFile.tsx'), 'export function old() { return true; }\n');
  const res = runRepl(
    ['create feature checkout', `import Foo --feature checkout --layers domain --from ${path.join(dir, 'OldFile.tsx')}`],
    dir,
  );
  assert.match(res.stdout, /\[tool: .*\] \[llm: 0 calls/);
  assert.match(res.stdout, /Next:\n\s*Open .*OldFile\.tsx and fill in each TODO\(import\) marker/);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'domain', 'Foo.tsx')), true);
});

test('repl output stays in order across several piped commands (no interleaving)', () => {
  // Regression test: readline's 'line' event used to fire for every buffered
  // line before an earlier async handler resolved, so output from later
  // commands (and their "Next:" hints) could appear before earlier ones.
  const dir = emptyProjectDir();
  const res = runRepl(
    ['create feature checkout', 'create domain Foo --feature checkout', 'validate --feature checkout'],
    dir,
  );
  const created = res.stdout.indexOf('Created feature checkout');
  const domainFile = res.stdout.indexOf('Created features/checkout/domain/Foo.tsx');
  const validateNext = res.stdout.lastIndexOf('Next:');
  assert.ok(created >= 0 && domainFile >= 0 && validateNext >= 0, 'expected all three markers present');
  assert.ok(created < domainFile, 'feature creation must be reported before the domain file');
  assert.ok(domainFile < validateNext, 'domain file creation must be reported before validate\'s own "Next:"');
});
