// Tests against trimmed copies of the REAL current demo ticket bodies (new "guide" shape).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cleanTitle } from '../lib/text.mjs';
import { parseDemoBody, stripComments } from '../lib/story.mjs';
import { sanitizeHtml } from '../lib/sanitize.mjs';
import { offlineSource } from '../lib/sources.mjs';
import { collectGuides, dropBoilerplate } from '../lib/collect.mjs';

const real = JSON.parse(fs.readFileSync(new URL('./fixtures/real-bodies.json', import.meta.url), 'utf8'));
const withDefaults = (i, extra = {}) => ({ state: 'closed', html_url: `https://github.com/o/r/issues/${i.number}`, updated_at: '2026-09-18T00:00:00Z', ...i, ...extra });
const LONG_COMMENT = '## What this demonstrates (plain summary)\n\n' + 'Plain summary sentence. '.repeat(80) + '\n\n```\n$ construct import --route /products\n```\n';

test('cleanTitle strips any [Demo...] tag', () => {
  assert.equal(cleanTitle('[Demo Guide] Scaffold features'), 'Scaffold features');
  assert.equal(cleanTitle('[Demo Epic] [Demo] x'), 'x');
  assert.equal(cleanTitle('[Demo] As a dev'), 'As a dev');
});

test('stripComments removes html comments, even multi-line', () => {
  assert.equal(stripComments('a<!-- demo-curator:v1 -- x\ny -->b'), 'ab');
  assert.equal(sanitizeHtml('<p>a</p><!-- secret -->'), '<p>a</p>');
});

test('parseDemoBody: real guide (#145)', () => {
  const g = parseDemoBody(real[145].body);
  assert.match(g.who, /team migrating a legacy page/);
  assert.match(g.problem, /Migrating a route by hand/);
  assert.match(g.hero, /route-import-146-ui-1-plan-proposed\.png$/);
  assert.equal(g.contents[146].benefit, 'Nothing is built until a human says yes; the scan is deterministic');
  assert.equal(g.contents[147].surface, 'CLI + UI');
  assert.match(g.why, /human approves the plan/);
  assert.match(g.evidence, /Evidence from a real run/);
  assert.equal(g.verified, '8dd69f5');
  assert.equal(g.verifiedDate, '2026-09-18');
  assert.doesNotMatch(g.why + g.who + g.problem, /demo-curator|per the user/);
});

test('parseDemoBody: real story (#146) and old-shape body returns null', () => {
  const s = parseDemoBody(real[146].body);
  assert.equal(s.sentence, 'As a team lead I want a route scanned and a plan proposed for my approval so that nothing is built without a human decision');
  assert.match(s.benefit, /Who benefits/);
  assert.equal(s.verified, '8dd69f5');
  assert.match(s.legacy, /^Part of #145/);
  assert.equal(parseDemoBody('Part of #1\n\n## What this demonstrates\n\nOld text.'), null);
});

function source() {
  return offlineSource({
    sub_issues: {
      125: [withDefaults(real[145]), withDefaults(real[127])],
      145: [withDefaults({ number: 146, title: real[146].title, body: real[146].body })],
      127: [withDefaults(real[128])],
    },
    comments: { 146: [{ body: LONG_COMMENT }] },
  });
}

test('collect: new shape wins; no internal wording, comments or [Demo tags leak', async () => {
  const { guides } = await collectGuides(source());
  const g = guides.find((x) => x.number === 145);
  assert.equal(g.title, 'Import a whole page by its URL: scan, plan, approve, build (guided route import)');
  assert.match(g.introHtml, /Who it is for/);
  assert.match(g.introHtml, /The problem it solves/);
  assert.match(g.hero, /plan-proposed\.png$/);
  assert.match(g.summary, /^A human approves the plan/);
  assert.equal(g.verified, '8dd69f5');
  const s = g.stories[0];
  assert.match(s.summary, /^As a team lead I want/);
  assert.match(s.benefitHtml, /Who benefits/);
  assert.equal(s.verified, '8dd69f5');
  assert.match(s.html, /Plain summary sentence/); // walkthrough taken from the write-up comment
  const everything = JSON.stringify(guides);
  for (const bad of ['<!--', '[Demo', 'per the user', 'demo-curator', 'already demoed in #134', 'Parent/tracking']) {
    assert.ok(!everything.includes(bad), `leaked: ${bad}`);
  }
});

test('collect: story with its walkthrough still in the body keeps it, minus the Part of line', async () => {
  const { guides } = await collectGuides(source());
  const s = guides.find((x) => x.number === 127).stories[0];
  assert.match(s.html, /What this does today/);
  assert.doesNotMatch(s.html, /Part of #127/);
  assert.equal(guides.find((x) => x.number === 127).stories[0].tocBlurb, 'Every layer folder exists, correctly named, in 0.01s');
});

test('collect: old-shape guide still works and drops Parent/tracking boilerplate', async () => {
  const old = withDefaults({ number: 300, title: '[Demo Epic] Old guide', body: 'Part of #125\n\nParent/tracking ticket for demoing things.\n\n## What this demonstrates\n\nThe plain old summary text lives here.\n\n## Subtasks\n- a' });
  const kid = withDefaults({ number: 301, title: '[Demo] Old story', body: 'Part of #300\n\nAn old style story body that is long enough to publish.' });
  const { guides } = await collectGuides(offlineSource({ sub_issues: { 125: [old], 300: [kid] } }));
  assert.equal(guides[0].title, 'Old guide');
  assert.match(guides[0].summary, /plain old summary/);
  assert.doesNotMatch(JSON.stringify(guides), /Parent\/tracking/);
});

test('dropBoilerplate removes leading and trailing "Part of #N" bookkeeping, keeps the rest', () => {
  const md = 'Part of #125.\n\n**As a** dev **I want** x.\n\n### Benefit\n- ok\n\nPart of #263.';
  assert.equal(dropBoilerplate(md), '**As a** dev **I want** x.\n\n### Benefit\n- ok');
  assert.equal(dropBoilerplate('Text mentioning Part of #5 inline stays.'), 'Text mentioning Part of #5 inline stays.');
});
