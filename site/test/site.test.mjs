import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { slugify, makeSlugger, cleanTitle, esc } from '../lib/text.mjs';
import { sanitizeHtml } from '../lib/sanitize.mjs';
import { extractImageUrls, rewriteImages, localImageName, firstMarkdownImage } from '../lib/images.mjs';
import { parseStoryBody, parsePartOf, splitReference, shiftHeadings } from '../lib/story.mjs';
import { offlineSource } from '../lib/sources.mjs';
import { collectGuides, isPublishable } from '../lib/collect.mjs';
import { build, parseArgs } from '../build.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const IMG = 'https://raw.githubusercontent.com/o/r/ui-screenshots/a.png';
const issue = (number, title, over = {}) => ({
  number, title, state: 'closed', html_url: `https://github.com/o/r/issues/${number}`,
  updated_at: '2026-09-01T00:00:00Z', body: `Part of #125\n\n## What this does\n\nA long enough body to be publishable here.\n\n![shot](${IMG})\n\n---\n\n**Setup / run**\nnpm i`, ...over,
});
const fixtures = (extra = {}) => ({
  issues: {},
  sub_issues: {
    125: [issue(10, '[Demo Epic] Guide A -- things', { body: 'Part of #125\n\n## What this demonstrates\n\nGuide A intro paragraph.' })],
    10: [issue(11, '[Demo] Story one'), issue(12, '[Demo] Story two'), issue(13, '[Demo] Old', { body: 'Part of #10\n\nThis one was replaced but has a long body text.' })],
  },
  comments: { 13: [{ body: 'Superseded by #12' }] },
  images: { [IMG]: PNG },
  ...extra,
});

test('slugify / slugger dedupe / cleanTitle / esc', () => {
  assert.equal(slugify('Hello, `World`!'), 'hello-world');
  const s = makeSlugger();
  assert.deepEqual([s('A b'), s('A b'), s('A b')], ['a-b', 'a-b-2', 'a-b-3']);
  assert.equal(cleanTitle('[Demo Epic] x -- y'), 'x — y');
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});

test('sanitizer strips scripts, handlers and javascript: urls', () => {
  const out = sanitizeHtml('<p onclick="x()">a</p><script>alert(1)</script><a href="javascript:alert(1)">b</a><iframe src="x"></iframe><img src=x onerror=alert(1)>');
  assert.doesNotMatch(out, /script|onclick|onerror|javascript:|iframe/i);
  assert.match(out, /<p>a<\/p>/);
});

test('image extraction and rewrite', () => {
  const html = `<p><a href="${IMG}"><img src="${IMG}" alt="x &amp; y" style="max-width: 100%;"></a><img src="rel.png"></p>`;
  assert.deepEqual(extractImageUrls(html), [IMG]);
  const out = rewriteImages(html, { [IMG]: 'assets/img/h.png' }, { prefix: '../../' });
  assert.match(out, /<img src="..\/..\/assets\/img\/h.png" alt="x &amp; y" loading="lazy"/);
  assert.match(out, /href="..\/..\/assets\/img\/h.png"/);
  assert.doesNotMatch(out, /raw\.githubusercontent/);
  assert.equal(firstMarkdownImage(`x ![a](${IMG}) y`), IMG);
  assert.match(localImageName(IMG, Buffer.from('abc')), /^[0-9a-f]{16}\.png$/);
});

test('story body: Part of, benefit, verified, reference split', () => {
  assert.equal(parsePartOf('Part of #127 (x)'), 127);
  const p = parseStoryBody('Part of #1\n\nIntro\n\n## Benefit\n\nSaves time.\n\n## Steps\n\n1. go\n\nverified on abc1234 today');
  assert.equal(p.benefit, 'Saves time.');
  assert.equal(p.verified, 'abc1234');
  assert.doesNotMatch(p.markdown, /Part of|Benefit|verified/);
  assert.match(p.markdown, /## Steps/);
  const s = splitReference('<p>a</p><hr><p><strong>Setup / run</strong></p>');
  assert.equal(s.main, '<p>a</p>');
  assert.match(s.reference, /Setup/);
  assert.equal(shiftHeadings('<h2>x</h2><h6>y</h6>'), '<h3>x</h3><h6>y</h6>');
});

test('isPublishable skips open, empty and superseded', () => {
  const long = 'x'.repeat(60);
  assert.equal(isPublishable({ state: 'open', body: long }), false);
  assert.equal(isPublishable({ state: 'closed', body: 'short' }), false);
  assert.equal(isPublishable({ state: 'closed', body: long }, [{ body: 'Superseded by #9' }]), false);
  assert.equal(isPublishable({ state: 'closed', body: long }, [{ body: 'Verified done' }]), true);
});

test('collect: sub-issue traversal, skipping superseded', async () => {
  const { guides, skipped, mode } = await collectGuides(offlineSource(fixtures()));
  assert.equal(mode, 'sub-issues');
  assert.equal(guides.length, 1);
  assert.deepEqual(guides[0].stories.map((s) => s.number), [11, 12]);
  assert.deepEqual(skipped.map((s) => s.number), [13]);
  assert.equal(guides[0].title, 'Guide A — things');
  assert.equal(guides[0].hero, IMG);
  assert.match(guides[0].stories[0].referenceHtml, /Setup/);
});

test('collect: Part of #N fallback when nothing is linked', async () => {
  const issues = {
    10: issue(10, '[Demo Epic] Guide A', { body: 'Part of #125\n\nGuide intro that is long enough to publish.' }),
    11: issue(11, '[Demo] Story one', { body: `Part of #10\n\nA long enough body to be publishable here, honestly.` }),
    12: issue(12, '[Demo] Story two', { body: `Part of #10\n\nAnother long enough body to be publishable here.` }),
    20: issue(20, '[Demo] Elsewhere', { body: `Part of #99\n\nBelongs to some other guide entirely, long body.` }),
  };
  const { guides, mode } = await collectGuides(offlineSource({ issues }));
  assert.equal(mode, 'part-of-fallback');
  assert.deepEqual(guides.map((g) => [g.number, g.stories.map((s) => s.number)]), [[10, [11, 12]]]);
});

test('build renders the two-audience site, downloads images, rewrites paths', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'site-test-'));
  const res = await build({ source: offlineSource(fixtures()), out, repo: 'o/r', buildTime: new Date('2026-09-18T00:00:00Z') });
  assert.equal(res.guides, 1);
  assert.equal(res.stories, 2);
  assert.equal(res.images, 1);
  assert.deepEqual(res.imageFailures, []);
  const slug = fs.readdirSync(path.join(out, 'user-guide', 'tutorials')).find((d) => d !== 'index.html');
  const guide = fs.readFileSync(path.join(out, 'user-guide', 'tutorials', slug, 'index.html'), 'utf8');
  assert.match(guide, /<h1>Guide A — things<\/h1>/);
  assert.match(guide, /id="11-story-one"/);
  assert.match(guide, /src="..\/..\/..\/assets\/img\/[0-9a-f]{16}\.png"/);
  assert.match(guide, /Setup, API and known limitations/);
  assert.doesNotMatch(guide, /raw\.githubusercontent/);
  assert.doesNotMatch(guide, /Old/);
  assert.doesNotMatch(guide, /View on GitHub|Demos tickets/);
  // old tutorial address redirects
  assert.match(fs.readFileSync(path.join(out, 'guides', slug, 'index.html'), 'utf8'), /url=..\/..\/user-guide\/tutorials\//);
  const home = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(home, /href="user-guide\/"/);
  assert.match(home, /href="developers\/"/);
  assert.match(home, /Guide A/);
  assert.match(home, /Documentation built <time datetime="2026-09-18T00:00:00.000Z">/);
  for (const p of ['user-guide/getting-started/', 'user-guide/concepts/', 'user-guide/how-to/create/', 'developers/architecture/', 'developers/cli-reference/', 'developers/rules-reference/', 'developers/execution-model/', 'developers/ast/', 'search/']) {
    assert.ok(fs.existsSync(path.join(out, p, 'index.html')), p);
  }
  assert.ok(fs.existsSync(path.join(out, '404.html')));
  assert.ok(fs.existsSync(path.join(out, 'assets/css/site.css')));
  fs.rmSync(out, { recursive: true });
});

test('generated and reused docs are current, and carry no tracker plumbing or dead links', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'site-test-'));
  await build({ source: offlineSource(fixtures()), out, repo: 'o/r', buildTime: new Date('2026-09-18T00:00:00Z') });
  const rules = fs.readFileSync(path.join(out, 'developers/rules-reference/index.html'), 'utf8');
  assert.match(rules, /PAGE-003/); // straight from DEFAULT_RULES
  const cli = fs.readFileSync(path.join(out, 'developers/cli-reference/index.html'), 'utf8');
  assert.match(cli, /construct research workflow/);
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
  walk(out);
  for (const f of files.filter((x) => x.endsWith('.html'))) {
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
