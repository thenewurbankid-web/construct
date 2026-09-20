import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { slugify, makeSlugger, esc } from '../lib/text.mjs';
import { sanitizeHtml } from '../lib/sanitize.mjs';
import { build, parseArgs } from '../build.mjs';
import { USER_GROUPS } from '../lib/structure.mjs';
import { makeTempDir } from '../../test-utils/tmpdir.mjs';

const BUILD_TIME = new Date('2026-09-20T00:00:00Z');
const walk = (d, files = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk(path.join(d, e.name), files) : files.push(path.join(d, e.name)));
  return files;
};
const exampleGroups = () => USER_GROUPS.filter((g) => g.group.startsWith('Examples: '));

test('slugify / slugger dedupe / esc', () => {
  assert.equal(slugify('Hello, `World`!'), 'hello-world');
  const s = makeSlugger();
  assert.deepEqual([s('A b'), s('A b'), s('A b')], ['a-b', 'a-b-2', 'a-b-3']);
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});

test('sanitizer strips scripts, handlers and javascript: urls', () => {
  const out = sanitizeHtml('<p onclick="x()">a</p><script>alert(1)</script><a href="javascript:alert(1)">b</a><iframe src="x"></iframe><img src=x onerror=alert(1)>');
  assert.doesNotMatch(out, /script|onclick|onerror|javascript:|iframe/i);
  assert.match(out, /<p>a<\/p>/);
});

test('structure: examples are split into CLI, Cockpit and Core, and each page states its surface', () => {
  assert.deepEqual(exampleGroups().map((g) => g.group), ['Examples: CLI', 'Examples: Cockpit', 'Examples: Core']);
  for (const g of exampleGroups()) {
    const surface = g.group.replace('Examples: ', '').toLowerCase();
    for (const p of g.pages) {
      assert.match(p.path, new RegExp(`^user-guide/examples/${surface}-`), `${p.path} is filed under the wrong surface`);
      assert.ok(fs.existsSync(new URL(`../../${p.file}`, import.meta.url)), `${p.file} exists`);
    }
  }
});

test('example pages: no user stories, the problem comes first, surfaces are never interleaved', () => {
  for (const g of exampleGroups()) {
    const surface = g.group.replace('Examples: ', '');
    for (const p of g.pages) {
      const md = fs.readFileSync(new URL(`../../${p.file}`, import.meta.url), 'utf8');
      assert.doesNotMatch(md, /\bAs an? [\w -]+ I want\b/i, `user story in ${p.file}`);
      assert.match(md, /^\*\*Problem\.\*\*/, `${p.file} does not open with the problem`);
      assert.match(md, /Checked against commit `[0-9a-f]{7}` on \d{4}-\d{2}-\d{2}/, `${p.file} has no checked-against line`);
      if (surface === 'CLI') assert.doesNotMatch(md, /!\[[^\]]*\]\(@img/, `${p.file}: screenshots do not belong on a CLI page`);
      if (surface === 'Core') assert.doesNotMatch(md, /!\[[^\]]*\]\(@img/, `${p.file}: screenshots do not belong on a core page`);
      if (surface === 'Cockpit') assert.doesNotMatch(md, /^```bash\n(?:construct|node) /m, `${p.file}: a bare CLI transcript does not belong on a Cockpit page`);
    }
  }
});

test('every image an example page uses exists in site/assets/img', () => {
  for (const g of exampleGroups()) {
    for (const p of g.pages) {
      const md = fs.readFileSync(new URL(`../../${p.file}`, import.meta.url), 'utf8');
      for (const m of md.matchAll(/\(@img\/([^)]+)\)/g)) assert.ok(fs.existsSync(new URL(`../assets/img/${m[1]}`, import.meta.url)), `${m[1]} referenced by ${p.file}`);
    }
  }
});

test('build renders the site offline: home pitch, examples, references, no ticket-derived tutorials', async () => {
  const out = makeTempDir('site-test-');
  const res = await build({ out, repo: 'o/r', buildTime: BUILD_TIME });
  assert.equal(res.examples, 9);
  const home = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(home, /Stop paying an AI to redo the same work/);
  assert.match(home, /cockpit, not an autopilot/);
  assert.match(home, /href="user-guide\/examples\/cli-scaffold-and-validate\/"/);
  assert.match(home, /href="user-guide\/examples\/cockpit-plan-and-run\/"/);
  assert.match(home, /href="user-guide\/examples\/core-plans-and-impact\/"/);
  assert.match(home, /Documentation built <time datetime="2026-09-20T00:00:00.000Z">/);
  assert.doesNotMatch(home, /walkthrough|user stor/i);
  for (const g of exampleGroups()) for (const p of g.pages) assert.ok(fs.existsSync(path.join(out, p.path, 'index.html')), p.path);
  const idx = fs.readFileSync(path.join(out, 'user-guide/examples/index.html'), 'utf8');
  for (const label of ['CLI', 'Cockpit', 'Core']) assert.match(idx, new RegExp(`<h2>${label}</h2>`));
  // A Cockpit page carries real screenshots, copied and linked relative to its own depth.
  const plan = fs.readFileSync(path.join(out, 'user-guide/examples/cockpit-plan-and-run/index.html'), 'utf8');
  assert.match(plan, /src="\.\.\/\.\.\/\.\.\/assets\/img\/cockpit-plan-impact\.webp"/);
  assert.ok(fs.existsSync(path.join(out, 'assets/img/cockpit-plan-impact.webp')));
  // The old tutorial address redirects to the examples.
  assert.match(fs.readFileSync(path.join(out, 'user-guide/tutorials/index.html'), 'utf8'), /url=..\/examples\//);
  assert.ok(!fs.existsSync(path.join(out, 'guides')));
  for (const p of ['user-guide/getting-started/', 'user-guide/concepts/', 'user-guide/cockpit/', 'user-guide/how-to/create/', 'developers/architecture/', 'developers/cli-reference/', 'developers/rules-reference/', 'developers/execution-model/', 'developers/ast/', 'search/']) {
    assert.ok(fs.existsSync(path.join(out, p, 'index.html')), p);
  }
  assert.ok(fs.existsSync(path.join(out, '404.html')));
  assert.ok(fs.existsSync(path.join(out, 'assets/css/site.css')));
  fs.rmSync(out, { recursive: true });
});

test('generated and reused docs are current, and carry no tracker plumbing or dead links', async () => {
  const out = makeTempDir('site-test-');
  await build({ out, repo: 'o/r', buildTime: BUILD_TIME });
  const rules = fs.readFileSync(path.join(out, 'developers/rules-reference/index.html'), 'utf8');
  assert.match(rules, /PAGE-003/); // straight from DEFAULT_RULES
  const cli = fs.readFileSync(path.join(out, 'developers/cli-reference/index.html'), 'utf8');
  assert.match(cli, /construct research workflow/);
  assert.match(cli, /construct review/);
  for (const f of walk(out).filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(f, 'utf8');
    const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/&#\d+;/g, "'").replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(text, /#\d{2,4}\b/, `ticket number leaked in ${path.relative(out, f)}`);
    assert.doesNotMatch(text, /CLAUDE\.md|subagent|orchestrat/i, `internal wording in ${path.relative(out, f)}`);
    for (const m of html.matchAll(/<(?:a|img|link)\b[^>]*?(?:href|src)="(?!https?:|mailto:|data:|\/)([^"#]+)/g)) {
      if (m[1].includes('pagefind/')) continue; // produced by the search indexer, off in tests
      let target = path.resolve(path.dirname(f), m[1]);
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
      assert.ok(fs.existsSync(target), `dead link ${m[1]} in ${path.relative(out, f)}`);
    }
  }
  fs.rmSync(out, { recursive: true });
});

test('markdown helpers: sections, includes, ticket stripping', async () => {
  const { extractSection, relevel, stripTicketRefs, stripTicketRefsHtml } = await import('../lib/markdown.mjs');
  const md = '# T\n\n## A\n\ntext\n\n```bash\n# not a heading\n```\n\n## B\n\nother\n';
  const { markdown } = extractSection(md, 'A');
  assert.match(markdown, /not a heading/);
  assert.doesNotMatch(markdown, /other/);
  assert.equal(relevel('## A\n\n### C\n', 3, true), '\n### C\n'.replace('\n### C', '\n#### C'));
  assert.equal(stripTicketRefs('Title (#96, the epic) and more (Epic 6.4/#100) end. Tracked under issue #104.'), 'Title and more end.');
  assert.doesNotMatch(stripTicketRefsHtml('<table><tr><th>#</th><th>Story</th></tr><tr><td>#128</td><td>x</td></tr></table>'), /#128/);
});

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['--out', 'x', '--repo', 'a/b']), { out: 'x', repo: 'a/b' });
});
