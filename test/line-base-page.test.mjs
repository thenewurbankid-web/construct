// #907: line.baseOn of a library page writes a page a route can serve (no props but params) and, when the library has
// an array fixture for the feature, one that already shows its data: a list of entries linking to their detail route,
// or a detail page that looks the id up. Bench run data-qwen3-4b-r1 needed read + setCode + run per page without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { createLineProject } from '../packages/engine/line/newProject.mjs';
import { createLinePlanService } from '../packages/engine/line/planService.mjs';
import { planBaseOn, applyChange } from '../packages/engine/line/ops.mjs';
import { typeCheckStaged } from '../packages/engine/line/typeGate.mjs';
import { singular, humanize, pagePropsOf, fixtureFor } from '../packages/engine/line/basePage.mjs';
import { validateLine } from '../packages/core/profiles/line/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const NEXT = path.join(here, '..', 'ui', 'client', 'node_modules', 'next');
const write = (root, rel, content) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content); };
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const LIST = "import type { ReactNode } from 'react';\n\nexport type ListPageProps = {\n  title: string;\n  toolbar?: ReactNode;\n  children?: ReactNode;\n  empty?: ReactNode;\n};\n\nexport function ListPage({ title, toolbar, children, empty }: ListPageProps) {\n  return (\n    <main>\n      <h1>{title}</h1>\n      {toolbar}\n      {children || empty}\n    </main>\n  );\n}\n";
const DETAIL = "import type { ReactNode } from 'react';\n\nexport type DetailPageProps = {\n  title: string;\n  back?: ReactNode;\n  children?: ReactNode;\n};\n\nexport function DetailPage({ title, back, children }: DetailPageProps) {\n  return (\n    <main>\n      {back}\n      <h1>{title}</h1>\n      <section>{children}</section>\n    </main>\n  );\n}\n";
const FORM = "'use client';\nimport type { ReactNode } from 'react';\n\nexport type FormPageProps = {\n  title: string;\n  onSubmit: () => void;\n  submitLabel: string;\n  children?: ReactNode;\n};\n\nexport function FormPage({ title, onSubmit, submitLabel, children }: FormPageProps) {\n  return (\n    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} aria-label={title}>\n      {children}\n      <button type=\"submit\">{submitLabel}</button>\n    </form>\n  );\n}\n";
const PRODUCTS = [
  { id: 'linen-shirt', name: 'Linen Shirt', category: 'Clothing', price: 48, description: 'A breathable linen shirt.', stock: 12 },
  { id: 'ceramic-mug', name: 'Ceramic Mug', category: 'Home', price: 14.5, description: 'A hand-glazed mug.', stock: 40 },
];

/** A new Line project with the bench's library pages, a products fixture and the catalog/product/checkout features. */
function project({ next = '14.2.15' } = {}) {
  const parent = fs.realpathSync(makeTempDir('line-base-page-'));
  const r = createLineProject(parent, { name: 'shop', firstFeature: 'catalog' });
  assert.equal(r.ok, true, r.sentence);
  const root = /** @type {string} */ (r.dir);
  write(root, 'package.json', JSON.stringify({ name: 'shop', private: true, dependencies: { next } }, null, 2));
  write(root, 'library/pages/ListPage.tsx', LIST);
  write(root, 'library/pages/DetailPage.tsx', DETAIL);
  write(root, 'library/pages/FormPage.tsx', FORM);
  write(root, 'library/fixtures/products.json', `${JSON.stringify(PRODUCTS, null, 2)}\n`);
  write(root, 'features/catalog/spec.md', '# catalog\n\n## As a shopper, I want to browse the products, so that I can find one to buy.\n\n- CAT-1: The list shows every product with its name, category and price.\n');
  write(root, 'features/product/spec.md', '# product\n\n## As a shopper, I want to see one product, so that I can decide.\n\n- PROD-1: The page shows the name, category and price.\n');
  write(root, 'features/checkout/spec.md', '# checkout\n\n## As a shopper, I want to pay, so that I get my order.\n\n- CHK-1: A form takes my address.\n');
  return { root, done: () => fs.rmSync(parent, { recursive: true, force: true }) };
}

test('basePage helpers: singular, humanize, the props a library page declares, the fixture a feature names', () => {
  assert.deepEqual(['products', 'categories', 'boxes', 'news', 'item'].map(singular), ['product', 'category', 'box', 'new', 'item']);
  assert.equal(humanize('submitLabel'), 'Submit label');
  assert.deepEqual(pagePropsOf(FORM, 'FormPage'), [
    { name: 'title', optional: false, type: 'string' }, { name: 'onSubmit', optional: false, type: '() => void' },
    { name: 'submitLabel', optional: false, type: 'string' }, { name: 'children', optional: true, type: 'ReactNode' },
  ]);
  assert.deepEqual(pagePropsOf('export function P({ a }: { a?: number }) { return null; }', 'P'), [{ name: 'a', optional: true, type: 'number' }]);
  assert.equal(pagePropsOf('export function Other() { return null; }', 'P'), null);
  const fx = [{ stem: 'products', rel: 'library/fixtures/products.json', rows: [] }, { stem: 'orders', rel: 'library/fixtures/orders.json', rows: [] }];
  assert.equal(fixtureFor(fx, 'product', '')?.stem, 'products', 'the feature is named after it');
  assert.equal(fixtureFor(fx, 'catalog', 'Browse the products; each product has a price.')?.stem, 'products', 'the spec mentions it');
  assert.equal(fixtureFor(fx, 'catalog', 'A page about nothing.'), null);
});

test('baseOn pages/ListPage with a matching fixture: a no-props page listing every entry, its name a link to the detail route, the spec\'s fields, money prices, an empty state', () => {
  const { root, done } = project();
  try {
    const change = planBaseOn(root, { libraryId: 'pages/ListPage', feature: 'catalog', name: 'ListPage' });
    const src = change.files[0].content;
    assert.equal(change.files[0].path, 'features/catalog/pages/ListPage.tsx');
    assert.match(src, /^\/\/ @line-base pages\/ListPage\n/);
    assert.match(src, /import Link from 'next\/link';/);
    assert.match(src, /import \{ ListPage as LibraryListPage \} from '\.\.\/\.\.\/\.\.\/library\/pages\/ListPage';/);
    assert.match(src, /import products from '\.\.\/\.\.\/\.\.\/library\/fixtures\/products\.json';/);
    assert.match(src, /type Product = \{ id: string; name: string; category: string; price: number \};/, 'only the fields it shows');
    assert.match(src, /export function ListPage\(\) \{/);
    assert.match(src, /<LibraryListPage title="Products" empty=\{<p>No products yet\.<\/p>\}>/);
    assert.match(src, /<Link href=\{`\/products\/\$\{item\.id\}`\}>\{item\.name\}<\/Link>/);
    assert.match(src, /<p>\{item\.category\}<\/p>/);
    assert.match(src, /<p>\{money\(item\.price\)\}<\/p>/);
    assert.match(src, /const money = \(n: number\) => `\$\$\{n\.toFixed\(2\)\}`;/);
    assert.doesNotMatch(src, /description|stock|ComponentProps|props/, 'fields the spec does not mention stay out');
    const r = applyChange(root, change);
    assert.equal(r.ok, true, r.sentence);
    assert.deepEqual(validateLine(root).violations.filter((v) => v.severity === 'error'), []);
  } finally { done(); }
});

test('baseOn pages/DetailPage with a matching fixture: takes {params}, looks the id up, a not-found state with a link back, a "Back to" link; async params on Next 15', () => {
  for (const [next, async] of [['14.2.15', false], ['^15.1.0', true]]) {
    const { root, done } = project({ next });
    try {
      const src = planBaseOn(root, { libraryId: 'pages/DetailPage', feature: 'product', name: 'DetailPage' }).files[0].content;
      assert.match(src, /^\/\/ @line-base pages\/DetailPage\n/);
      assert.match(src, async
        ? /export async function DetailPage\(\{ params \}: \{ params: Promise<\{ id: string \}> \}\) \{\n {2}const \{ id \} = await params;/
        : /export function DetailPage\(\{ params \}: \{ params: \{ id: string \} \}\) \{\n {2}const \{ id \} = params;/);
      assert.match(src, /const item = \(products as Product\[\]\)\.find\(\(entry\) => entry\.id === id\);/);
      assert.match(src, /const back = <Link href="\/">Back to Products<\/Link>;/);
      assert.match(src, /if \(!item\) \{\n {4}return <LibraryDetailPage title="Product not found" back=\{back\} \/>;/);
      assert.match(src, /<LibraryDetailPage title=\{item\.name\} back=\{back\}>/);
      assert.match(src, /<p>\{item\.category\}<\/p>\n\s*<p>\{money\(item\.price\)\}<\/p>/, 'the spec\'s fields first');
      assert.match(src, /<dt>Description<\/dt>\n\s*<dd>\{item\.description\}<\/dd>/, 'then the rest of the record');
      assert.match(src, /<dd>\{String\(item\.stock\)\}<\/dd>/);
    } finally { done(); }
  }
});

test('baseOn links follow routes already claimed: the list links to the detail page\'s route, the detail links back to the list\'s', () => {
  const { root, done } = project();
  try {
    write(root, 'features/product/pages/ItemPage.tsx', "// @line-base pages/DetailPage\n// @line-route /shop/:id\nimport products from '../../../library/fixtures/products.json';\nexport function ItemPage() { return null; }\n");
    write(root, 'features/catalog/pages/Shelf.tsx', "// @line-base pages/ListPage\n// @line-route /shop\nimport products from '../../../library/fixtures/products.json';\nexport function Shelf() { return null; }\n");
    write(root, 'features/cart/pages/CartPage.tsx', "// @line-base pages/ListPage\n// @line-route /cart\nexport function CartPage() { return null; }\n");
    assert.match(planBaseOn(root, { libraryId: 'pages/ListPage', feature: 'catalog', name: 'ListPage' }).files[0].content, /href=\{`\/shop\/\$\{item\.id\}`\}/);
    assert.match(planBaseOn(root, { libraryId: 'pages/DetailPage', feature: 'product', name: 'DetailPage' }).files[0].content, /<Link href="\/shop">Back to Products<\/Link>/, 'not the cart, which lists another thing');
  } finally { done(); }
});

test('baseOn is generic: field names come from the fixture keys and the spec text, not from e-commerce', () => {
  const { root, done } = project();
  try {
    write(root, 'library/fixtures/recipes.json', JSON.stringify([{ slug: 'pho', title: 'Pho', cuisine: 'Vietnamese', minutes: 90, totalCost: 7.5 }]));
    write(root, 'features/recipes/spec.md', '# recipes\n\n## As a cook, I want to browse recipes, so that I can pick one.\n\n- REC-1: Each recipe shows its cuisine, its minutes and its total cost.\n');
    const src = planBaseOn(root, { libraryId: 'pages/ListPage', feature: 'recipes', name: 'RecipeList' }).files[0].content;
    assert.match(src, /import recipes from '\.\.\/\.\.\/\.\.\/library\/fixtures\/recipes\.json';/);
    assert.match(src, /type Recipe = \{ slug: string; title: string; cuisine: string; minutes: number; totalCost: number \};/);
    assert.match(src, /<ListPage title="Recipes" empty=\{<p>No recipes yet\.<\/p>\}>/);
    assert.match(src, /<Link href=\{`\/recipes\/\$\{item\.slug\}`\}>\{item\.title\}<\/Link>/);
    assert.match(src, /<p>\{item\.cuisine\}<\/p>\n\s*<p>\{String\(item\.minutes\)\}<\/p>\n\s*<p>\{money\(item\.totalCost\)\}<\/p>/);
  } finally { done(); }
});

test('baseOn of a page with no fixture, or another library page: a no-props page passing its required props, never the props pass-through', () => {
  const { root, done } = project();
  try {
    const form = planBaseOn(root, { libraryId: 'pages/FormPage', feature: 'checkout', name: 'CheckoutPage' }).files[0].content;
    assert.equal(form, "// @line-base pages/FormPage\n'use client';\nimport { FormPage } from '../../../library/pages/FormPage';\n\nexport function CheckoutPage() {\n  return <FormPage title=\"Checkout\" onSubmit={() => {}} submitLabel=\"Submit\" />;\n}\n");
    // The checkout spec names no fixture: its list page is the library page with its title.
    const list = planBaseOn(root, { libraryId: 'pages/ListPage', feature: 'checkout', name: 'OrdersPage' }).files[0].content;
    assert.equal(list, "// @line-base pages/ListPage\nimport { ListPage } from '../../../library/pages/ListPage';\n\nexport function OrdersPage() {\n  return <ListPage title=\"Checkout\" />;\n}\n");
    // A component is still a pass-through wrapper: a component may take props.
    assert.match(planBaseOn(root, { libraryId: 'components/Button', feature: 'checkout', name: 'PayButton' }).files[0].content, /export function PayButton\(props: ComponentProps<typeof Button> & object\)/);
  } finally { done(); }
});

test('baseOn then addRoute on a type-checked project: the list at / and the detail at /products/:id land with no TYPE_ERROR and compile clean', { skip: !fs.existsSync(path.join(NEXT, 'link.d.ts')) && 'needs next in ui/client/node_modules' }, async () => {
  const { root, done } = project();
  try {
    write(root, 'tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, jsx: 'react-jsx', module: 'esnext', moduleResolution: 'bundler', target: 'es2020', noEmit: true, skipLibCheck: true, resolveJsonModule: true, esModuleInterop: true, types: [], paths: { 'next/link': [path.join(NEXT, 'link')] } } }));
    fs.symlinkSync(path.join(here, '..', 'node_modules'), path.join(root, 'node_modules'), 'dir');
    const svc = createLinePlanService({ root, commands: null, trace: null, records: null });
    const WHY = 'A #907 test step.';
    const land = async (tool, args) => {
      const r = /** @type {any} */ (await svc.addStep({ tool, args, why: WHY }, 'agent'));
      assert.equal(r.ok, true, `${tool}: ${r.code} ${r.sentence}`);
      const step = r.steps.find((s) => s.id === r.stepId);
      if (step.state === 'waiting') assert.equal((/** @type {any} */ (await svc.approve(r.stepId, 'ui'))).ok, true);
      const run = /** @type {any} */ (await svc.runNext('agent'));
      assert.equal(run.ok, true, run.sentence);
      const ran = run.steps.find((s) => s.id === r.stepId);
      assert.equal(ran.state, 'done', `${tool}: ${ran.sentence}`);
      assert.equal(ran.result.apply.ok, true, ran.sentence);
    };
    for (const [libraryId, feature, name] of [['pages/ListPage', 'catalog', 'ListPage'], ['pages/DetailPage', 'product', 'DetailPage']]) {
      const change = planBaseOn(root, { libraryId, feature, name });
      const types = typeCheckStaged(root, change.files);
      assert.ok(types, 'the project type-checks');
      assert.deepEqual(types.errors, [], `${name} compiles`);
      await land('line.baseOn', { libraryId, feature, name });
    }
    await land('line.addRoute', { route: '/', page: 'features/catalog/pages/ListPage.tsx' });
    await land('line.addRoute', { route: '/products/:id', page: 'features/product/pages/DetailPage.tsx' });
    assert.match(read(root, 'app/page.tsx'), /export \{ ListPage as default \}/);
    assert.match(read(root, 'app/products/[id]/page.tsx'), /export \{ DetailPage as default \}/);
    assert.match(read(root, 'features/product/pages/DetailPage.tsx'), /^\/\/ @line-base pages\/DetailPage\n\/\/ @line-route \/products\/:id\n/);
  } finally { done(); }
});
