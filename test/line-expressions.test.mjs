// line-expressions: COMPONENT-005/006 and PAGE-008 are back on under the Line profile, each with a typed fix: one
// line.extractExpression step (packages/engine/line/expressions.mjs) that moves the inline conditional or loop into a
// typed expression inside the project. The scenario runs through the plan service, as plan-cli and Cockpit do: the
// warning, its fix added as a step, run, landed; the page renders the same, tsc is clean, the warning is gone and no
// import of the new files leaves the project.
import test from 'node:test';
// The type gate degrades to warnings past its budget; a loaded test machine must not turn a refusal into a warning.
process.env.LINE_TYPE_GATE_BUDGET_MS ??= '60000';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createLineProject } from '../packages/engine/line/newProject.mjs';
import { createLinePlanService } from '../packages/engine/line/planService.mjs';
import { validateLine } from '../packages/core/profiles/line/index.mjs';
import { withViolationFixes } from '../packages/engine/line/fixes.mjs';
import { freeVariables, planExtractExpression, EXPRESSION_RULES } from '../packages/engine/line/expressions.mjs';
import { typeCheckStaged } from '../packages/engine/line/typeGate.mjs';
import { conditionsOf } from '../packages/engine/line/conditions.mjs';
import { parseToAst, collectInlineJsxLogic } from '../packages/ast/index.mjs';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WHY = 'A line-expressions test step.';
const PAGE = 'features/home/pages/Shelf.tsx';
const SHELF = `// @line-base pages/ListPage
interface Product { id: string; name: string; price: number }
const CURRENCY = '$';
export function Shelf({ products, title, onPick }: { products: Product[]; title: string; onPick: (id: string) => void }) {
  const onSale = products.length > 2;
  const label = (p: Product): string => \`\${p.name} \${CURRENCY}\${p.price}\`;
  return (
    <div>
      <h1>{title}</h1>
      {onSale ? <p>Sale on {title}!</p> : <p>No sale</p>}
      <ul>{products.map((p) => <li key={p.id} onClick={() => onPick(p.id)}>{label(p)}</li>)}</ul>
    </div>
  );
}
`;

/** A Line project that can be type-checked: a tsconfig and React (and its types) linked from this repo. */
function project() {
  const parent = fs.realpathSync(makeTempDir('line-expr-'));
  const r = createLineProject(parent, { name: 'shop', firstFeature: 'home' });
  assert.equal(r.ok, true, r.sentence);
  const root = /** @type {string} */ (r.dir);
  fs.mkdirSync(path.join(root, 'node_modules', '@types'), { recursive: true });
  fs.symlinkSync(path.join(repo, 'node_modules', 'react'), path.join(root, 'node_modules', 'react'));
  fs.symlinkSync(path.join(repo, 'node_modules', '@types', 'react'), path.join(root, 'node_modules', '@types', 'react'));
  write(root, 'tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, jsx: 'react-jsx', module: 'esnext', moduleResolution: 'bundler', target: 'es2020', noEmit: true, skipLibCheck: true } }));
  write(root, PAGE, SHELF);
  return { root, done: () => fs.rmSync(parent, { recursive: true, force: true }) };
}
const write = (root, rel, content) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content); };
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const codeFiles = (root, dir) => (fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir), { recursive: true }).map((f) => `${dir}/${String(f).split(path.sep).join('/')}`).filter((f) => /\.tsx?$/.test(f)) : []);

/** Every type error of the library and feature code (what `tsc --noEmit` reports for them). */
function tscErrors(root) {
  const files = [...codeFiles(root, 'library'), ...codeFiles(root, 'features')].map((f) => path.join(root, f));
  const cfg = ts.parseJsonConfigFileContent(JSON.parse(read(root, 'tsconfig.json')), ts.sys, root);
  const program = ts.createProgram({ rootNames: files, options: cfg.options });
  return ts.getPreEmitDiagnostics(program).map((d) => `${d.file ? path.relative(root, d.file.fileName) : ''} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
}

let renders = 0;
/**
 * Render `Shelf` with `props` to static markup: the page and the expressions are compiled with TypeScript into a
 * scratch folder of the project (so `react` resolves from it) and rendered by a small server renderer (function
 * components called, host elements printed; handlers are not markup).
 */
async function renderShelf(root, props) {
  const out = `.render-${renders += 1}`;
  for (const rel of codeFiles(root, 'features')) {
    const { outputText } = ts.transpileModule(read(root, rel), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 }, fileName: rel });
    write(root, `${out}/${rel.replace(/\.tsx?$/, '.mjs')}`, outputText.replace(/from '(\.[^']+)'/g, "from '$1.mjs'"));
  }
  const mod = await import(pathToFileURL(path.join(root, out, PAGE.replace(/\.tsx$/, '.mjs'))).href);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const render = (n) => {
    if (n === null || n === undefined || typeof n === 'boolean') return '';
    if (Array.isArray(n)) return n.map(render).join('');
    if (typeof n !== 'object') return esc(n);
    if (typeof n.type === 'function') return render(n.type(n.props));
    if (typeof n.type === 'symbol') return render(n.props.children);
    const attrs = Object.entries(n.props).filter(([k, v]) => k !== 'children' && typeof v !== 'function').map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    return `<${n.type}${attrs}>${render(n.props.children)}</${n.type}>`;
  };
  return render(mod.Shelf(props));
}

const PRODUCTS = [{ id: 'a', name: 'Lamp', price: 12 }, { id: 'b', name: 'Desk', price: 80 }, { id: 'c', name: 'Chair', price: 45 }];
const expressionWarnings = (root, file) => validateLine(root).violations.filter((v) => v.file === file && EXPRESSION_RULES.includes(v.rule));

test('an inline conditional and a loop using outer values: the warning shows, its top fix lands, the page renders the same, tsc is clean, the warning is gone and nothing is imported from outside the project', async () => {
  const { root, done } = project();
  try {
    const before = [await renderShelf(root, { products: PRODUCTS, title: 'Shop', onPick: () => {} }), await renderShelf(root, { products: PRODUCTS.slice(0, 1), title: 'Shop', onPick: () => {} })];
    assert.match(before[0], /<p>Sale on Shop!<\/p><ul><li>Lamp \$12<\/li>/);
    assert.match(before[1], /<p>No sale<\/p>/);
    const findingsBefore = new Set(validateLine(root).violations.filter((v) => !EXPRESSION_RULES.includes(v.rule)).map((v) => `${v.rule}|${v.file}`));

    const svc = createLinePlanService({ root, commands: null, trace: null, records: null });
    const names = [];
    for (let round = 0; round < 4; round += 1) {
      const warnings = withViolationFixes(root, expressionWarnings(root, PAGE));
      if (!warnings.length) break;
      assert.equal(warnings[0].rule, 'PAGE-008');
      const [fix] = /** @type {any[]} */ (warnings[0].fixes);
      assert.equal(fix.rank, 1);
      assert.equal(fix.step.tool, 'line.extractExpression');
      assert.match(fix.sentence, new RegExp(`new expression ${fix.step.args.name} \\(features/home/expressions/${fix.step.args.name}\\.tsx\\)`));
      names.push(fix.step.args.name);
      const added = /** @type {any} */ (await svc.addStep({ tool: fix.step.tool, args: fix.step.args, why: WHY }, 'agent'));
      assert.equal(added.ok, true, added.sentence);
      const step = added.steps.find((s) => s.id === added.stepId);
      if (step.state === 'waiting') assert.equal((/** @type {any} */ (await svc.approve(added.stepId, 'ui'))).ok, true);
      const ran = /** @type {any} */ (await svc.runNext('agent'));
      assert.equal(ran.ok, true, ran.sentence);
      const done1 = ran.steps.find((s) => s.id === added.stepId);
      assert.equal(done1.state, 'done', done1.sentence);
      assert.equal(done1.result.apply.ok, true, done1.sentence);
    }
    assert.deepEqual(names, ['ShowOnSale', 'ProductList'], 'the conditional, then the loop');
    assert.deepEqual(expressionWarnings(root, PAGE), [], 'the warning is gone');

    // The page renders the same.
    const after = [await renderShelf(root, { products: PRODUCTS, title: 'Shop', onPick: () => {} }), await renderShelf(root, { products: PRODUCTS.slice(0, 1), title: 'Shop', onPick: () => {} })];
    assert.deepEqual(after, before);
    // tsc is clean, and validate shows no new finding anywhere.
    assert.deepEqual(tscErrors(root), []);
    const findingsAfter = validateLine(root).violations.filter((v) => !EXPRESSION_RULES.includes(v.rule)).map((v) => `${v.rule}|${v.file}`);
    assert.deepEqual(findingsAfter.filter((k) => !findingsBefore.has(k)), []);

    // Every value the JSX used is a typed prop, and the call site passes it.
    const list = read(root, 'features/home/expressions/ProductList.tsx');
    assert.match(list, /products: Product\[\];/);
    assert.match(list, /onPick: \(id: string\) => void;/);
    assert.match(list, /label: \(p: Product\) => string;/);
    assert.match(list, /import type \{ Product \} from '\.\.\/pages\/Shelf';/);
    assert.doesNotMatch(list, /@line-base/, 'no library expression ProductList, so no base');
    const page = read(root, PAGE);
    assert.match(page, /^\/\/ @line-base pages\/ListPage\n/);
    assert.match(page, /<ShowOnSale onSale=\{onSale\} title=\{title\} \/>/);
    assert.match(page, /<ul><ProductList products=\{products\} onPick=\{onPick\} label=\{label\} \/><\/ul>/);
    assert.match(page, /^export interface Product/m, 'the page exports the type the expression uses');

    // No import of the new files leaves the project (no typed-contracts path, no ../ past the root).
    for (const rel of codeFiles(root, 'features/home/expressions')) {
      for (const [, spec] of read(root, rel).matchAll(/from '([^']+)'/g)) {
        if (!spec.startsWith('.')) { assert.equal(spec, 'react', `${rel} imports ${spec}`); continue; }
        const to = path.resolve(path.dirname(path.join(root, rel)), spec);
        assert.ok(!path.relative(root, to).startsWith('..'), `${rel} imports ${spec}, outside the project`);
      }
      assert.doesNotMatch(read(root, rel), /typed-contracts|defineExpression/);
    }
  } finally { done(); }
});

test('free variables: every outer value the JSX uses is found with its declared type; one left out is caught by the type gate', () => {
  const { root, done } = project();
  try {
    const hits = collectInlineJsxLogic(parseToAst(SHELF));
    const loop = /** @type {any} */ (hits.find((h) => h.kind === 'loop'));
    const free = freeVariables(root, PAGE, SHELF, loop.node.range);
    assert.deepEqual(free.props.map((p) => [p.name, p.type]), [['products', 'Product[]'], ['onPick', '(id: string) => void'], ['label', '(p: Product) => string']]);
    assert.deepEqual(free.localTypes.map((t) => [t.name, t.exported]), [['Product', false]]);
    // `p` (the loop's own parameter) and `id` are not free; a top-level constant used only inside `label` is not either.
    assert.ok(!free.props.some((p) => ['p', 'CURRENCY'].includes(p.name)));
    // An expression that forgets `onPick` does not compile: the type gate refuses it.
    const missing = "export function Broken({ items }: { items: string[] }) {\n  return <>{items.map((x) => <li key={x} onClick={() => onPick(x)}>{x}</li>)}</>;\n}\n";
    const r = typeCheckStaged(root, [{ path: 'features/home/expressions/Broken.tsx', content: missing }]);
    assert.ok(r && r.errors.some((e) => e.code === 'TS2304' && /onPick/.test(e.message)), JSON.stringify(r?.errors));
  } finally { done(); }
});

test('base, name and conditions: a library expression of that name becomes the @line-base; a taken name is refused; pre and post name the new file', () => {
  const { root, done } = project();
  try {
    write(root, 'library/expressions/ShowOnSale.tsx', 'export function ShowOnSale({ onSale }: { onSale: boolean }) {\n  return <>{onSale}</>;\n}\n');
    const c = planExtractExpression(root, { file: PAGE, name: 'ShowOnSale' });
    const expr = c.files.find((f) => f.path === 'features/home/expressions/ShowOnSale.tsx');
    assert.match(String(expr?.content), /^\/\/ @line-base expressions\/ShowOnSale\n/);
    assert.match(c.summary, /It is based on the library expression ShowOnSale\./);
    write(root, 'features/home/expressions/Taken.tsx', 'export const Taken = 1;\n');
    assert.throws(() => planExtractExpression(root, { file: PAGE, name: 'Taken' }), (e) => /** @type {any} */ (e).code === 'NAME_TAKEN');
    assert.throws(() => planExtractExpression(root, { file: PAGE, name: 'lower' }), (e) => /** @type {any} */ (e).code === 'BAD_NAME');
    assert.throws(() => planExtractExpression(root, { file: 'library/expressions/ShowOnSale.tsx' }), (e) => /** @type {any} */ (e).code === 'WRONG_KIND');
    const cond = /** @type {any} */ (conditionsOf('line.extractExpression', { file: PAGE, name: 'ProductList' }, { library: 'library', features: 'features' }));
    assert.deepEqual(cond.post, { and: [{ exists: { path: ['files', PAGE] } }, { exists: { path: ['files', 'features/home/expressions/ProductList.tsx'] } }] });
    // A feature expression with no base passes LINE-BASE; one naming a missing base does not.
    write(root, 'features/home/expressions/Own.tsx', 'export function Own() {\n  return null;\n}\n');
    write(root, 'features/home/expressions/Bad.tsx', '// @line-base expressions/Nope\nexport function Bad() {\n  return null;\n}\n');
    const base = validateLine(root, { rules: ['LINE-BASE', 'LINE-LAYOUT'] }).violations.map((v) => `${v.rule} ${v.file}`);
    assert.ok(!base.includes('LINE-BASE features/home/expressions/Own.tsx'));
    assert.ok(base.includes('LINE-BASE features/home/expressions/Bad.tsx'));
    assert.ok(!base.some((b) => b.startsWith('LINE-LAYOUT')), base.join('; '));
  } finally { done(); }
});
