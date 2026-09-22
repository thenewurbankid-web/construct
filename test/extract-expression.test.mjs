// #517 (part of #500's Phase 3a) -- construct refactor extract-expression.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createFeature } from '../packages/core/generators.mjs';
import { extractExpression } from '../packages/core/extractExpression.mjs';
import { validateArchitecture } from '../packages/core/architecture-enforcer.mjs';
import { aggregateValidation } from '../packages/core/registry.mjs';
import { DEFAULT_ENFORCERS } from '../packages/engine/defaultEnforcers.mjs';
import { ConstructError } from '../packages/core/diagnostics.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

function tmpProject() {
  return makeTempDir('construct-extract-expression-');
}

// The exact real fixture cited by #505's closing note (fixtures/frozen-presentation/project-bad/
// features/cpo/pages/CpoHome.tsx's inline `.map()`), reproduced verbatim into an isolated temp
// project rather than run against the shared fixture directly — that fixture is asserted on,
// unmodified, by test/frozen.test.mjs and test/architecture-enforcer.test.mjs.
const CPO_HOME_SOURCE = `// BAD: a hand-written fork of the frozen design-tool screen (same exported
// name, same markup) instead of importing it.
export default function CpoHome(props: { title: string; items: string[] }) {
  return (
    <div className="home">
      <header>
        <h1>{props.title}</h1>
        <nav>
          <a href="/">Home</a>
          <a href="/reports">Reports</a>
        </nav>
      </header>
      <main>
        <section>
          <h2>Overview</h2>
          <ul>
            {props.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
`;

function scaffoldCpoHome(dir) {
  createFeature(dir, 'cpo');
  const pageFile = path.join(dir, 'features', 'cpo', 'pages', 'CpoHome.tsx');
  fs.writeFileSync(pageFile, CPO_HOME_SOURCE);
  return pageFile;
}

test('the real PAGE-008 fixture is flagged before extraction', () => {
  const dir = tmpProject();
  scaffoldCpoHome(dir);
  const { violations } = validateArchitecture(dir, { files: ['features/cpo/pages/CpoHome.tsx'] });
  assert.deepEqual(violations.map((v) => v.rule), ['PAGE-008']);
});

test('extractExpression takes the real PAGE-008 fixture from flagged to clean end-to-end', () => {
  const dir = tmpProject();
  const pageFile = scaffoldCpoHome(dir);

  const result = extractExpression(dir, pageFile);

  assert.equal(result.expression.name, 'ItemList');
  assert.equal(result.expression.file, 'features/cpo/expressions/ItemList.tsx');
  assert.equal(result.component.name, 'ItemRow');
  assert.equal(result.component.file, 'features/cpo/components/ItemRow.tsx');
  assert.equal(fs.existsSync(path.join(dir, result.expression.file)), true);
  assert.equal(fs.existsSync(path.join(dir, result.component.file)), true);

  // The page itself: PAGE-008 is gone, and nothing else about the file changed except the
  // extraction + a new import — the surrounding static markup (<nav>, <header>) is untouched.
  const pageAfter = fs.readFileSync(pageFile, 'utf8');
  assert.match(pageAfter, /import \{ ItemList \} from '\.\.\/expressions\/ItemList';/);
  assert.match(pageAfter, /<ItemList items=\{props\.items\} \/>/);
  assert.doesNotMatch(pageAfter, /\.map\(/);
  assert.match(pageAfter, /<nav>/); // untouched static markup survives verbatim

  // The new Expression unit satisfies EXPR-005/EXPR-006 by construction.
  const exprSource = fs.readFileSync(path.join(dir, result.expression.file), 'utf8');
  assert.match(exprSource, /defineExpression\(/);
  assert.match(exprSource, /\bchildren\b/);
  assert.match(exprSource, /<ItemRow key=\{item\}>\{item\}<\/ItemRow>/);

  // The companion Component (EXPR-004: an Expression must not hand-author native markup itself).
  const compSource = fs.readFileSync(path.join(dir, result.component.file), 'utf8');
  assert.match(compSource, /defineComponent\(/);
  assert.match(compSource, /<li \{\.\.\.rest\}>\{children\}<\/li>/);

  // The whole project — including the SoC/skeleton checks (registry.mjs's aggregateValidation,
  // not just architecture-enforcer.mjs's own pass) — is genuinely clean, not just PAGE-008-silent.
  const { violations, ok } = aggregateValidation(dir, DEFAULT_ENFORCERS);
  assert.deepEqual(violations.filter((v) => v.severity === 'error'), []);
  assert.equal(ok, true);
});

test('extractExpression is idempotent-safe: a second run targets the next flagged occurrence', () => {
  const dir = tmpProject();
  createFeature(dir, 'cpo');
  const pageFile = path.join(dir, 'features', 'cpo', 'pages', 'CpoHome.tsx');
  fs.writeFileSync(pageFile, `export default function CpoHome(props: { items: string[]; tags: string[] }) {
  return (
    <div>
      <ul>{props.items.map((item) => (<li key={item}>{item}</li>))}</ul>
      <ul>{props.tags.map((tag) => (<li key={tag}>{tag}</li>))}</ul>
    </div>
  );
}
`);
  const first = extractExpression(dir, pageFile);
  assert.equal(first.expression.name, 'ItemList');
  const second = extractExpression(dir, pageFile);
  assert.equal(second.expression.name, 'TagList');

  const after = fs.readFileSync(pageFile, 'utf8');
  assert.doesNotMatch(after, /\.map\(/);
  const { ok } = validateArchitecture(dir);
  assert.equal(ok, true);
});

test('extractExpression extracts a ternary conditional into a boolean-typed expression', () => {
  const dir = tmpProject();
  createFeature(dir, 'cart');
  const pageFile = path.join(dir, 'features', 'cart', 'pages', 'CartPage.tsx');
  fs.writeFileSync(pageFile, `export default function CartPage(props: { isLoggedIn: boolean }) {
  return (
    <div>
      {props.isLoggedIn ? <span>Welcome back</span> : <a href="/login">Log in</a>}
    </div>
  );
}
`);
  const result = extractExpression(dir, pageFile);
  assert.equal(result.expression.name, 'ShowLoggedIn');
  assert.equal(result.components.length, 2);

  const exprSource = fs.readFileSync(path.join(dir, result.expression.file), 'utf8');
  assert.match(exprSource, /isLoggedIn: boolean/);
  assert.match(exprSource, /defineExpression\(/);

  const { ok, violations } = validateArchitecture(dir);
  assert.deepEqual(violations, []);
  assert.equal(ok, true);
});

test('extractExpression extracts a logical-&& conditional without an else branch', () => {
  const dir = tmpProject();
  createFeature(dir, 'cart');
  const pageFile = path.join(dir, 'features', 'cart', 'pages', 'CartPage.tsx');
  fs.writeFileSync(pageFile, `export default function CartPage(props: { discountActive: boolean }) {
  return <div>{props.discountActive && <span>10% off</span>}</div>;
}
`);
  const result = extractExpression(dir, pageFile, { name: 'discount-banner' });
  assert.equal(result.expression.name, 'DiscountBanner');
  const { ok } = validateArchitecture(dir);
  assert.equal(ok, true);
});

test('--name overrides the derived Expression name', () => {
  const dir = tmpProject();
  const pageFile = scaffoldCpoHome(dir);
  const result = extractExpression(dir, pageFile, { name: 'productList' });
  assert.equal(result.expression.name, 'ProductList');
  assert.equal(result.expression.file, 'features/cpo/expressions/ProductList.tsx');
});

test('--range selects a specific flagged occurrence among several', () => {
  const dir = tmpProject();
  createFeature(dir, 'cpo');
  const pageFile = path.join(dir, 'features', 'cpo', 'pages', 'CpoHome.tsx');
  fs.writeFileSync(pageFile, `export default function CpoHome(props: { items: string[]; tags: string[] }) {
  return (
    <div>
      <ul>{props.items.map((item) => (<li key={item}>{item}</li>))}</ul>
      <ul>{props.tags.map((tag) => (<li key={tag}>{tag}</li>))}</ul>
    </div>
  );
}
`);
  const source = fs.readFileSync(pageFile, 'utf8');
  const tagsMapStart = source.indexOf('props.tags.map');
  const tagsMapEnd = source.indexOf('))', tagsMapStart) + 2;
  const result = extractExpression(dir, pageFile, { range: [tagsMapStart, tagsMapEnd] });
  assert.equal(result.expression.name, 'TagList');
  // the items.map() is untouched
  assert.match(fs.readFileSync(pageFile, 'utf8'), /props\.items\.map/);
});

test('dryRun writes nothing but returns the same shape', () => {
  const dir = tmpProject();
  const pageFile = scaffoldCpoHome(dir);
  const before = fs.readFileSync(pageFile, 'utf8');
  const result = extractExpression(dir, pageFile, { dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(fs.readFileSync(pageFile, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(dir, result.expression.file)), false);
  assert.ok(result.preview[result.page.file].includes('<ItemList'));
});

test('throws when the file has no inline conditional/loop logic to extract', () => {
  const dir = tmpProject();
  createFeature(dir, 'cpo');
  const pageFile = path.join(dir, 'features', 'cpo', 'pages', 'CpoHome.tsx');
  fs.writeFileSync(pageFile, `export default function CpoHome() {\n  return <div>Hello</div>;\n}\n`);
  assert.throws(() => extractExpression(dir, pageFile), ConstructError);
});

test('throws for a component/page-external file', () => {
  const dir = tmpProject();
  createFeature(dir, 'cpo');
  const domainFile = path.join(dir, 'features', 'cpo', 'domain', 'Foo.tsx');
  fs.mkdirSync(path.dirname(domainFile), { recursive: true });
  fs.writeFileSync(domainFile, `export function Foo() { return true; }\n`);
  assert.throws(() => extractExpression(dir, domainFile), ConstructError);
});

test('throws for an out-of-range --range', () => {
  const dir = tmpProject();
  const pageFile = scaffoldCpoHome(dir);
  assert.throws(() => extractExpression(dir, pageFile, { range: [0, 1] }), ConstructError);
});

test('extracting into an existing Expression name gets a unique file', () => {
  const dir = tmpProject();
  const pageFile = scaffoldCpoHome(dir);
  fs.mkdirSync(path.join(dir, 'features', 'cpo', 'expressions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'cpo', 'expressions', 'ItemList.tsx'), '// pre-existing\n');
  const result = extractExpression(dir, pageFile);
  assert.equal(result.expression.name, 'ItemList2');
});
