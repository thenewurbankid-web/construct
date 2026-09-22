import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { slugify, makeSlugger, esc } from '../../packages/docs-site/lib/text.mjs';
import { sanitizeHtml } from '../../packages/docs-site/lib/sanitize.mjs';
import { build, parseArgs } from '../build.mjs';
import { USER_GROUPS, EXAMPLE_SURFACES, examplePages } from '../../packages/docs-site/lib/structure.mjs';
import { makeTempDir } from '../../test-utils/tmpdir.mjs';

const BUILD_TIME = new Date('2026-09-20T00:00:00Z');
const walk = (d, files = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk(path.join(d, e.name), files) : files.push(path.join(d, e.name)));
  return files;
};
const exampleGroups = () => EXAMPLE_SURFACES.map((surface) => ({ surface, pages: examplePages(surface) }));

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

test('structure: the user guide is grouped by product, with a page for each family member', () => {
  assert.deepEqual(USER_GROUPS.map((g) => g.group), ['Start', 'Construct', 'Cockpit', 'Videos', 'CLI']);
  const paths = USER_GROUPS.flatMap((g) => g.pages.map((p) => p.path));
  for (const p of ['user-guide/line/', 'user-guide/construct/', 'user-guide/cockpit/', 'user-guide/cli/']) assert.ok(paths.includes(p), `${p} is missing`);
  // Every page's markdown source exists, and no page is registered twice.
  assert.equal(new Set(paths).size, paths.length, 'a page is registered twice');
  for (const g of USER_GROUPS) for (const p of g.pages) assert.ok(fs.existsSync(new URL(`../../${p.file}`, import.meta.url)), `${p.file} exists`);
  // The Cockpit and CLI groups carry their own examples; Core examples belong to the framework.
  assert.ok(USER_GROUPS.find((g) => g.group === 'Construct').pages.every((p) => !p.example || p.example === 'Core'));
  assert.ok(USER_GROUPS.find((g) => g.group === 'Cockpit').pages.every((p) => !p.example || p.example === 'Cockpit'));
  assert.ok(USER_GROUPS.find((g) => g.group === 'CLI').pages.every((p) => !p.example || p.example === 'CLI'));
});

test('structure: examples are split into CLI, Cockpit and Core, and each page states its surface', () => {
  assert.deepEqual(exampleGroups().map((g) => g.surface), ['CLI', 'Cockpit', 'Core']);
  for (const g of exampleGroups()) {
    const surface = g.surface.toLowerCase();
    assert.ok(g.pages.length > 0, `no ${g.surface} examples`);
    for (const p of g.pages) {
      assert.match(p.path, new RegExp(`^user-guide/examples/${surface}-`), `${p.path} is filed under the wrong surface`);
      assert.ok(fs.existsSync(new URL(`../../${p.file}`, import.meta.url)), `${p.file} exists`);
    }
  }
});

test('example pages: no user stories, the problem comes first, surfaces are never interleaved', () => {
  for (const g of exampleGroups()) {
    const surface = g.surface;
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
  assert.match(home, /AI guesses\. Construct computes\./);
  assert.match(home, /Try it in 60 seconds/);
  assert.match(home, /See it work in the Cockpit/);
  assert.equal((home.match(/class="btn primary"/g) || []).length, 1, 'one primary call to action');
  assert.match(home, /small tools that give the same answer every time/);
  assert.doesNotMatch(home, /\blayer\b|envelope|worktree|blast radius/i);
  // The family: every member named, each with its own section to go to, and the open-core boundary stated.
  for (const member of ['Line', 'Construct', 'Cockpit', 'command line']) assert.match(home, new RegExp(`<strong>${member}</strong>`), `${member} is not named on the home page`);
  for (const p of ['user-guide/line/', 'user-guide/construct/', 'user-guide/cockpit/', 'user-guide/cli/']) assert.match(home, new RegExp(`href="${p.replace(/\//g, '\\/')}"`), `no link to ${p}`);
  assert.match(home, /open source under the MIT licence; the Cockpit/);
  assert.doesNotMatch(home, /Pick how you like to work/);
  assert.match(home, /href="user-guide\/examples\/cli-scaffold-and-validate\/"/);
  assert.match(home, /href="user-guide\/examples\/cockpit-plan-and-run\/"/);
  assert.match(home, /href="user-guide\/examples\/core-plans-and-impact\/"/);
  assert.match(home, /Documentation built <time datetime="2026-09-20T00:00:00.000Z">/);
  assert.doesNotMatch(home, /walkthrough|user stor/i);
  for (const g of exampleGroups()) for (const p of g.pages) assert.ok(fs.existsSync(path.join(out, p.path, 'index.html')), p.path);
  const idx = fs.readFileSync(path.join(out, 'user-guide/examples/index.html'), 'utf8');
  for (const label of EXAMPLE_SURFACES) assert.match(idx, new RegExp(`<h2>${label}</h2>`));
  // A short page for each product, reachable from the guide.
  for (const p of ['user-guide/line/', 'user-guide/construct/', 'user-guide/cli/']) assert.ok(fs.existsSync(path.join(out, p, 'index.html')), p);
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
  const { extractSection, relevel, stripTicketRefs, stripTicketRefsHtml } = await import('../../packages/docs-site/lib/markdown.mjs');
  const md = '# T\n\n## A\n\ntext\n\n```bash\n# not a heading\n```\n\n## B\n\nother\n';
  const { markdown } = extractSection(md, 'A');
  assert.match(markdown, /not a heading/);
  assert.doesNotMatch(markdown, /other/);
  assert.equal(relevel('## A\n\n### C\n', 3, true), '\n### C\n'.replace('\n### C', '\n#### C'));
  assert.equal(stripTicketRefs('Title (#96, the epic) and more (Epic 6.4/#100) end. Tracked under issue #104.'), 'Title and more end.');
  assert.doesNotMatch(stripTicketRefsHtml('<table><tr><th>#</th><th>Story</th></tr><tr><td>#128</td><td>x</td></tr></table>'), /#128/);
});

test('friendliness: three-item nav, product side menu, where-am-I line, quickstart first, plain words', async () => {
  const out = makeTempDir('site-test-');
  await build({ out, repo: 'o/r', buildTime: BUILD_TIME });
  const gs = fs.readFileSync(path.join(out, 'user-guide/getting-started/index.html'), 'utf8');
  assert.match(gs, /<nav class="primary"[^>]*>(?:<a [^>]*>[^<]+<\/a>){3}<\/nav>/);
  for (const label of ['Home', 'Guide', 'For developers']) assert.match(gs, new RegExp(`>${label}</a>`));
  assert.ok(gs.indexOf('Try it in 60 seconds') < gs.indexOf('What just happened'), 'quickstart comes before the explanation');
  // The side menu is grouped by product, in order, and never by surface.
  const sidebar = /<aside class="sidebar"[\s\S]*?<\/aside>/.exec(gs)[0];
  assert.deepEqual([...sidebar.matchAll(/<p class="side-h">([^<]+)<\/p>/g)].map((m) => m[1]), ['Start', 'Construct', 'Cockpit', 'Videos', 'CLI']);
  assert.doesNotMatch(gs, /side-h">Examples/);
  assert.match(gs, /<p class="kicker">Start<\/p>/);
  const plan = fs.readFileSync(path.join(out, 'user-guide/examples/cockpit-plan-and-run/index.html'), 'utf8');
  assert.match(plan, /<p class="kicker">Cockpit<\/p>/);
  assert.match(plan, /aria-current="page"/);
  for (const g of exampleGroups()) for (const p of g.pages) {
    const html = fs.readFileSync(path.join(out, p.path, 'index.html'), 'utf8');
    for (const h of ['Do this', 'You get', 'Why it matters']) assert.match(html, new RegExp(`<h2 id="[^"]*">${h}<`), `${p.path} lacks "${h}"`);
  }
  const prose = plan.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(prose, /\bworktree\b|blast radius|envelope/i);
  fs.rmSync(out, { recursive: true });
});

test('API reference: core, engine and AST are generated from source, versioned, and list a known module and export', async () => {
  const out = makeTempDir('site-api-test-');
  await build({ out, repo: 'o/r', buildTime: BUILD_TIME, version: '0.9', api: ['core', 'engine', 'ast'] });
  const idx = fs.readFileSync(path.join(out, 'developers/api/index.html'), 'utf8');
  assert.match(idx, /v0\.9/);
  for (const id of ['core', 'engine', 'ast']) assert.match(idx, new RegExp(`href="[./]*developers/api/${id}/"`));
  const engine = fs.readFileSync(path.join(out, 'developers/api/engine/index.html'), 'utf8');
  assert.match(engine, /packages\/engine\/pipeline/, 'a known module is listed');
  const page = fs.readFileSync(path.join(out, 'developers/api/engine/packages/engine/pipeline/index.html'), 'utf8');
  assert.match(page, /runPipeline/, 'a known export is documented');
  assert.match(page, /<h[1-4][^>]*>Parameters/, 'params are rendered');
  assert.match(page, /v0\.9/, 'the page carries the version it was built for');
  assert.ok(fs.existsSync(path.join(out, 'developers/api/ast/packages/ast/parse/index.html')));
  assert.ok(!fs.existsSync(path.join(out, 'developers/api/tools')), 'packages not requested are not built');
  // Without `api` a build carries no API pages (library default).
  const plain = makeTempDir('site-noapi-test-');
  await build({ out: plain, repo: 'o/r', buildTime: BUILD_TIME });
  assert.ok(!fs.existsSync(path.join(plain, 'developers/api')));
  fs.rmSync(out, { recursive: true });
  fs.rmSync(plain, { recursive: true });
});

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['--out', 'x', '--repo', 'a/b']), { out: 'x', repo: 'a/b' });
});

test('video pages offer a download and the published site leaves out video history', async () => {
  const out = makeTempDir('site-test-');
  await build({ out, repo: 'o/r', buildTime: BUILD_TIME });
  const page = fs.readFileSync(path.join(out, 'user-guide/videos/ticket-to-story/index.html'), 'utf8');
  assert.match(page, /<video controls/);
  assert.match(page, /<figcaption><a href="[^"]*01-ticket-to-story\.webm" download>Download the video/);
  assert.ok(fs.existsSync(path.join(out, 'assets/video/01-ticket-to-story.webm')));
  assert.ok(!fs.existsSync(path.join(out, 'assets/video/history')), 'earlier takes stay in the repo, not on the site');
  fs.rmSync(out, { recursive: true });
});
