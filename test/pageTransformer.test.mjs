import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { transformPristineSource, ingestPage } from '../src/engine/pageTransformer.mjs';
import { createFeature } from '../src/generators.mjs';
import { validateArchitecture } from '../src/architecture-enforcer.mjs';
import { ConstructError, EXIT_CODES } from '../src/diagnostics.mjs';
import { parseToAst } from '../src/parser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..');
const bin = path.join(REPO_ROOT, 'bin', 'construct.mjs');
const FIXTURE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'fixtures', 'subframe-export', 'CheckoutExport.tsx'), 'utf8');

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-page-transformer-'));
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n');
  createFeature(dir, 'checkout');
  fs.mkdirSync(path.join(dir, 'features', 'checkout', 'components'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'features', 'checkout', 'components', 'Card.tsx'),
    `export function Card({ children }: { children: React.ReactNode }) {\n  return <div className="card">{children}</div>;\n}\n`,
  );
  return dir;
}

// ---- transformPristineSource: pure, in-memory ------------------------------

test('transformPristineSource catalogs every interactive prop across the JSX tree, deduped', () => {
  const { slots } = transformPristineSource(FIXTURE_SOURCE, { feature: 'checkout', name: 'Checkout' });
  assert.deepEqual(slots, [
    { name: 'onSubmit', kind: 'callback' },
    { name: 'value', kind: 'value' },
    { name: 'onChange', kind: 'callback' },
    { name: 'onClick', kind: 'callback' },
  ]);
});

test('transformPristineSource generates a Props interface declaring every slot with a real type', () => {
  const { propsSource } = transformPristineSource(FIXTURE_SOURCE, { feature: 'checkout', name: 'Checkout' });
  assert.match(propsSource, /export interface CheckoutPageProps \{/);
  assert.match(propsSource, /onSubmit: \(event: React\.FormEvent<HTMLFormElement>\) => void;/);
  assert.match(propsSource, /value: string;/);
  assert.match(propsSource, /onChange: \(value: string\) => void;/);
  assert.match(propsSource, /onClick: \(\) => void;/);
});

test('transformPristineSource produces a presentation-only page: state/local handlers stripped, attrs rewired to props', () => {
  const { pageSource } = transformPristineSource(FIXTURE_SOURCE, { feature: 'checkout', name: 'Checkout' });

  // Local state and the handler that closed over it are gone entirely.
  assert.doesNotMatch(pageSource, /useState/);
  assert.doesNotMatch(pageSource, /quantity/);
  assert.doesNotMatch(pageSource, /handleIncrement/);
  assert.doesNotMatch(pageSource, /setQuantity/);

  // Each catalogued attribute is rewired to reference the same-named prop.
  assert.match(pageSource, /onSubmit=\{onSubmit\}/);
  assert.match(pageSource, /value=\{value\}/);
  assert.match(pageSource, /onChange=\{onChange\}/);
  assert.match(pageSource, /onClick=\{onClick\}/);

  // A still-used sibling component import is retained; an unused hook import is dropped.
  assert.match(pageSource, /import \{ Card \} from '\.\.\/components\/Card';/);
  assert.doesNotMatch(pageSource, /from 'react'/);

  // Signature destructures exactly the discovered slots against the new Props type.
  assert.match(pageSource, /export function CheckoutPage\(\{ onSubmit, value, onChange, onClick \}: CheckoutPageProps\)/);

  // The result must actually be parseable TSX.
  assert.doesNotThrow(() => parseToAst(pageSource));
});

test('transformPristineSource throws a clear ConstructError when no exported component function is found', () => {
  assert.throws(() => transformPristineSource(`export const x = 1;\n`, { feature: 'checkout', name: 'Checkout' }), (err) => {
    assert.ok(err instanceof ConstructError);
    assert.match(err.message, /No exported React component function/);
    return true;
  });
});

test('transformPristineSource handles a concise-body arrow component (no braces) with no interactive props', () => {
  const { pageSource, slots } = transformPristineSource(
    `export const Empty = () => (<div className="empty">Nothing here</div>);\n`,
    { feature: 'checkout', name: 'Empty' },
  );
  assert.deepEqual(slots, []);
  assert.match(pageSource, /export function EmptyPage\(_props: EmptyPageProps\)/);
  assert.doesNotThrow(() => parseToAst(pageSource));
});

// ---- ingestPage: filesystem-backed, end-to-end via validateArchitecture ---

test('ingestPage writes a page + Props file that passes construct validate cleanly', () => {
  const dir = tmpProject();
  const { pageFile, propsFile, slots } = ingestPage(dir, 'Checkout', 'checkout', path.join(REPO_ROOT, 'fixtures', 'subframe-export', 'CheckoutExport.tsx'));

  assert.equal(pageFile, path.join(dir, 'features', 'checkout', 'pages', 'CheckoutPage.tsx'));
  assert.equal(propsFile, path.join(dir, 'features', 'checkout', 'pages', 'CheckoutPageProps.ts'));
  assert.equal(slots.length, 4);
  assert.equal(fs.existsSync(pageFile), true);
  assert.equal(fs.existsSync(propsFile), true);

  const { violations } = validateArchitecture(dir);
  assert.deepEqual(violations.filter((v) => v.severity === 'error'), []);
});

test('ingestPage throws a usage error for a missing source file', () => {
  const dir = tmpProject();
  assert.throws(() => ingestPage(dir, 'Checkout', 'checkout', path.join(dir, 'nope.tsx')), (err) => {
    assert.ok(err instanceof ConstructError);
    assert.equal(err.exitCode, EXIT_CODES.USAGE_ERROR);
    return true;
  });
});

// ---- second acceptance criterion: a hand-authored pages/ file that imports
// xstate / a custom hook / a service is still flagged post-ingestion -------

test('a pages/ file that imports xstate is flagged (existing PAGE-006 coverage)', () => {
  const dir = tmpProject();
  fs.writeFileSync(
    path.join(dir, 'features', 'checkout', 'pages', 'Rogue.tsx'),
    `import { createMachine } from 'xstate';\nexport function Rogue(){ createMachine({}); return null; }\n`,
  );
  const { violations } = validateArchitecture(dir);
  assert.ok(violations.some((v) => v.rule === 'PAGE-006' && v.file === 'features/checkout/pages/Rogue.tsx'));
});

test('a pages/ file that imports a custom hook is flagged (PAGE-006, the gap this ticket closed)', () => {
  const dir = tmpProject();
  fs.mkdirSync(path.join(dir, 'features', 'checkout', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'checkout', 'hooks', 'useCart.tsx'), `export function useCart(){ return { items: [] }; }\n`);
  fs.writeFileSync(
    path.join(dir, 'features', 'checkout', 'pages', 'Rogue.tsx'),
    `import { useCart } from '../hooks/useCart';\nexport function Rogue(){ const { items } = useCart(); return null; }\n`,
  );
  const { violations } = validateArchitecture(dir);
  assert.ok(violations.some((v) => v.rule === 'PAGE-006' && v.file === 'features/checkout/pages/Rogue.tsx'));
});

test('a pages/ file that imports a service is flagged (existing PAGE-003 coverage)', () => {
  const dir = tmpProject();
  fs.writeFileSync(
    path.join(dir, 'features', 'checkout', 'pages', 'Rogue.tsx'),
    `import { fetchTotal } from '../services/TotalService';\nexport function Rogue(){ return null; }\n`,
  );
  const { violations } = validateArchitecture(dir);
  assert.ok(violations.some((v) => v.rule === 'PAGE-003' && v.file === 'features/checkout/pages/Rogue.tsx'));
});

// ---- end-to-end via the real CLI binary ------------------------------------

test('construct create page <name> --feature <f> --from <path> ingests end to end and construct validate passes', () => {
  const dir = tmpProject();
  const res = spawnSync('node', [
    bin, 'create', 'page', 'Checkout', '--feature', 'checkout', '--from', path.join(REPO_ROOT, 'fixtures', 'subframe-export', 'CheckoutExport.tsx'),
  ], { encoding: 'utf8', cwd: dir });

  assert.equal(res.status, EXIT_CODES.OK, res.stderr);
  assert.match(res.stdout, /CheckoutPage\.tsx/);
  assert.match(res.stdout, /CheckoutPageProps\.ts/);
  assert.match(res.stdout, /4 slot\(s\)/);

  const validateRes = spawnSync('node', [bin, 'validate'], { encoding: 'utf8', cwd: dir });
  assert.equal(validateRes.status, EXIT_CODES.OK, validateRes.stdout);
});
