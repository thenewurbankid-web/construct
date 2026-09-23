// #533 (Slice 3 of #518's design) -- the "Wrap with..." read model: which flagged PAGE-008
// conditional/loop encloses a JSX selection, and how each existing Expression in scope fits it.
// Additive to #527's own palette.test.mjs -- buildPalette itself is untouched by anything here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildPalette, buildWrapSuggestions, describeWrapHit, expressionShape, findWrapHit, wrapFit } from '../packages/engine/palette.mjs';
import { extractExpression } from '../packages/core/extractExpression.mjs';
import { createFeature } from '../packages/core/generators.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const PAGE_SOURCE = `export default function CpoHome(props: { items: string[]; loggedIn: boolean }) {
  return (
    <div className="home">
      <ul>
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {props.loggedIn ? <span>Welcome</span> : <span>Guest</span>}
    </div>
  );
}
`;

function project() {
  const dir = makeTempDir('construct-palette-wrap-');
  createFeature(dir, 'cpo');
  const pageFile = path.join(dir, 'features', 'cpo', 'pages', 'CpoHome.tsx');
  fs.writeFileSync(pageFile, PAGE_SOURCE);
  return { dir, pageFile };
}

test('findWrapHit: the smallest flagged hit enclosing a selection range', () => {
  const { pageFile } = project();
  const source = fs.readFileSync(pageFile, 'utf8');
  const liStart = source.indexOf('<li');
  const liEnd = source.indexOf('</li>') + '</li>'.length;
  const hit = findWrapHit(source, [liStart, liEnd]);
  assert.equal(hit.kind, 'loop');

  const spanStart = source.indexOf('<span>Welcome');
  const spanEnd = spanStart + '<span>Welcome</span>'.length;
  const condHit = findWrapHit(source, [spanStart, spanEnd]);
  assert.equal(condHit.kind, 'conditional');
});

test('findWrapHit: a selection outside any flagged shape returns null', () => {
  const { pageFile } = project();
  const source = fs.readFileSync(pageFile, 'utf8');
  const divStart = source.indexOf('<div className="home">');
  // The outer <div> itself is not inside a conditional/loop -- only its descendants are.
  const hit = findWrapHit(source, [divStart, divStart + 5]);
  assert.equal(hit, null);
});

test('describeWrapHit: names the real subject and PAGE-008', () => {
  const { pageFile } = project();
  const source = fs.readFileSync(pageFile, 'utf8');
  const hit = findWrapHit(source);
  const info = describeWrapHit(source, hit);
  assert.equal(info.kind, 'loop');
  assert.equal(info.subject, 'items');
  assert.match(info.summary, /\.map\(\)/);
  assert.match(info.summary, /items/);
  assert.equal(info.rule, 'PAGE-008');
});

test('expressionShape: classifies a real extractExpression-generated Expression correctly', () => {
  const { dir, pageFile } = project();
  const result = extractExpression(dir, pageFile); // extracts the loop (first flagged hit) -> ItemList
  const loopShape = expressionShape(dir, result.expression.file, result.expression.name);
  assert.equal(loopShape, 'loop');

  const second = extractExpression(dir, pageFile); // now the conditional -> ShowLoggedIn
  const condShape = expressionShape(dir, second.expression.file, second.expression.name);
  assert.equal(condShape, 'conditional');
});

test('expressionShape: a file with no matching Props interface is "unknown", never a hard rule', () => {
  const dir = makeTempDir('construct-palette-wrap-unknown-');
  createFeature(dir, 'cpo');
  const exprFile = 'features/cpo/expressions/ShowForRole.tsx';
  fs.mkdirSync(path.dirname(path.join(dir, exprFile)), { recursive: true });
  fs.writeFileSync(path.join(dir, exprFile), `export function ShowForRole({ children }) { return children; }\n`);
  assert.equal(expressionShape(dir, exprFile, 'ShowForRole'), 'unknown');
});

test('wrapFit: same shape fits, opposite shape is dimmed with a plain-language reason, unknown is never dimmed', () => {
  assert.deepEqual(wrapFit('loop', 'loop'), { fit: 'fits', reason: null });
  assert.deepEqual(wrapFit('conditional', 'conditional'), { fit: 'fits', reason: null });
  const notFit = wrapFit('loop', 'conditional');
  assert.equal(notFit.fit, 'not-a-fit');
  assert.match(notFit.reason, /loop/);
  const unknown = wrapFit('loop', 'unknown');
  assert.deepEqual(unknown, { fit: 'unknown', reason: null });
});

test('buildWrapSuggestions: sorts fits first, dims non-fits, leaves unknown-shape entries undimmed', () => {
  const { dir, pageFile } = project();
  const source = fs.readFileSync(pageFile, 'utf8');

  // A real loop-shaped Expression (built by the codemod itself) plus a hand-written one with no
  // discoverable shape -- both must stay visible (never silently hidden), only the codemod-built
  // ones are confidently classified.
  const loopResult = extractExpression(dir, pageFile);
  fs.writeFileSync(
    path.join(dir, 'features/cpo/expressions/ShowForRole.tsx'),
    `export function ShowForRole({ children }) { return children; }\n`,
  );

  const freshSource = fs.readFileSync(pageFile, 'utf8');
  const palette = buildPalette(dir, 'cpo');
  assert.equal(palette.ok, true);

  // The remaining flagged hit after the first extraction is the conditional.
  const hit = findWrapHit(freshSource);
  assert.equal(hit.kind, 'conditional');
  const { hit: hitInfo, suggestions } = buildWrapSuggestions(dir, freshSource, [hit.node.range[0], hit.node.range[1]], palette);
  assert.equal(hitInfo.kind, 'conditional');

  const itemList = suggestions.find((s) => s.name === loopResult.expression.name);
  assert.equal(itemList.fit, 'not-a-fit'); // loop-shaped, selection is a conditional
  assert.ok(itemList.reason);

  const showForRole = suggestions.find((s) => s.name === 'ShowForRole');
  assert.equal(showForRole.fit, 'unknown'); // no discoverable Props shape -- never dimmed on a guess

  // Never silently hidden: both stay in the list regardless of fit.
  assert.equal(suggestions.length, 2);
});

test('buildWrapSuggestions: no flagged hit under the selection means no suggestions at all', () => {
  const { dir, pageFile } = project();
  const source = fs.readFileSync(pageFile, 'utf8');
  const palette = buildPalette(dir, 'cpo');
  const divStart = source.indexOf('<div className="home">');
  const { hit, suggestions } = buildWrapSuggestions(dir, source, [divStart, divStart + 5], palette);
  assert.equal(hit, null);
  assert.deepEqual(suggestions, []);
});
