// #921 path-first proof: the hand-written path for two bench points, CAT-2 (the Category filter) and CART-1 (the
// "Cart (n)" link, state shared across pages through a provider), as Trace would build it: typed stubs with stable ids
// (typed-contracts factories), the wiring done (pages, provider, layout), and each stub's input -> output examples
// DERIVED by the small functions in `derive` from SPEC.md and the fixture file, never from bench/ecommerce/acceptance.
//
//   installPath(root, {specText})  writes the contracts copy, the stubs, the wiring and <root>/line/path/path.json
//   REFERENCE                      a reference body per stub (tests and the report's equivalence check only; never
//                                  shown to a builder)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeholderBody } from '../../../packages/engine/line/path/stubs.mjs';
import { PATH_FILE } from '../../../packages/engine/line/path/check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../../..');
const CONTRACTS_SRC = path.join(REPO, 'packages/core/typed-contracts');
export const CONTRACTS_DIR = 'library/contracts';
export const FIXTURE = 'library/fixtures/products.json';

// ---- derivation: SPEC.md + fixtures -> example values (deterministic; each throws when the spec and fixture disagree) --

/** One numbered point's text from SPEC.md, by id. */
export function pointText(specText, id) {
  const m = new RegExp(`^\\d+\\.\\s+${id}:\\s+(.+)$`, 'm').exec(specText);
  if (!m) throw new Error(`SPEC.md has no point ${id}`);
  return m[1].trim();
}

export const derive = {
  /** CAT-2 "offers All, Clothing, Home and Electronics" -> ['All', 'Clothing', 'Home', 'Electronics']. */
  categoryList(specText) {
    const m = /offers (.+?);/.exec(pointText(specText, 'CAT-2'));
    if (!m) throw new Error('CAT-2 does not list what the filter offers');
    return m[1].split(/,\s*|\s+and\s+/).map((s) => s.trim()).filter(Boolean);
  },
  /** CAT-2 "shows only its 4 products, and All shows all 12": the per-category and total counts the fixture must match. */
  categoryCounts(specText) {
    const t = pointText(specText, 'CAT-2');
    return { each: Number(/only its (\d+) products/.exec(t)?.[1]), all: Number(/All shows all (\d+)/.exec(t)?.[1]) };
  },
  /** Rows of one category ('All' = every row), checked against the spec's counts. */
  rowsOf(specText, products, category) {
    const rows = category === 'All' ? products : products.filter((p) => p.category === category);
    const c = derive.categoryCounts(specText);
    if (rows.length !== (category === 'All' ? c.all : c.each)) throw new Error(`the fixture has ${rows.length} rows for ${category}; SPEC.md CAT-2 says ${category === 'All' ? c.all : c.each}`);
    return rows;
  },
  /** CART-1 `like "Cart (3)"` -> the label template and the example count (3). */
  cartLabel(specText) {
    const m = /like "(Cart) \((\d+)\)"/.exec(pointText(specText, 'CART-1'));
    if (!m) throw new Error('CART-1 has no "Cart (n)" example');
    return { label: (n) => `${m[1]} (${n})`, n: Number(m[2]) };
  },
  /** PROD-2 "(default 1, at least 1)" -> 1; the field and button names. */
  addToCart(specText) {
    const t = pointText(specText, 'PROD-2');
    return { field: /field labelled "([^"]+)"/.exec(t)?.[1], defaultQty: Number(/default (\d+)/.exec(t)?.[1]), button: /an "([^"]+)" button/.exec(t)?.[1], status: /says "([^"]+)"/.exec(t)?.[1] };
  },
  /** The two lines whose quantities make CART-1's example count: the first two fixture products, n-1 and 1. */
  twoLines(specText, products) {
    const { n } = derive.cartLabel(specText);
    return [{ id: products[4].id, quantity: n - 1 }, { id: products[9].id, quantity: 1 }];
  },
};

// ---- sources -------------------------------------------------------------------------------------------------------

const factories = (from) => `import { defineDomain, defineService, defineComponent, definePage } from '${from}/factories';`;
const stub = (lines) => lines.filter((l) => l !== null).join('\n');

/** The stub files: id -> {file, fn, export, layer, source}. */
function stubFiles() {
  const lib = '../../../library/contracts';
  const files = {
    'catalog.domain.categoryOptions': { file: 'features/catalog/domain/categoryOptions.ts', fn: 'categoryOptionsBody', export: 'categoryOptions', layer: 'domain',
      source: (b) => stub([`import { defineDomain } from '${lib}/factories';`, "import type { Product, CategoryOption } from '../contracts/products';", '',
        '/** @path-stub catalog.domain.categoryOptions -- the choices of the Category filter. */',
        `export function categoryOptionsBody({ products }: { products: Product[] }): CategoryOption[] ${b}`, '',
        "export const categoryOptions = defineDomain<{ products: Product[] }, CategoryOption[]>('categoryOptions', categoryOptionsBody);", '']) },
    'catalog.domain.filterByCategory': { file: 'features/catalog/domain/filterByCategory.ts', fn: 'filterByCategoryBody', export: 'filterByCategory', layer: 'domain',
      source: (b) => stub([`import { defineDomain } from '${lib}/factories';`, "import type { Product } from '../contracts/products';", '',
        '/** @path-stub catalog.domain.filterByCategory -- the products the chosen category shows. */',
        `export function filterByCategoryBody({ products, category }: { products: Product[]; category: string }): Product[] ${b}`, '',
        "export const filterByCategory = defineDomain<{ products: Product[]; category: string }, Product[]>('filterByCategory', filterByCategoryBody);", '']) },
    'catalog.service.listProducts': { file: 'features/catalog/services/listProducts.ts', fn: 'listProductsBody', export: 'listProducts', layer: 'service',
      source: (b) => stub([`import { defineService } from '${lib}/factories';`, "import type { Product, ProductsContract } from '../contracts/products';", '',
        '/** @path-stub catalog.service.listProducts -- every product, from the products contract. */',
        `export function listProductsBody({ api }: { api: ProductsContract }): Product[] ${b}`, '',
        "export const listProducts = defineService<{ api: ProductsContract }, Product[]>('listProducts', listProductsBody);", '']) },
    'catalog.component.CategoryFilter': { file: 'features/catalog/components/CategoryFilter.tsx', fn: 'CategoryFilterView', export: 'CategoryFilter', layer: 'component',
      source: (b) => stub(["'use client';", `import { defineComponent } from '${lib}/factories';`, "import type { CategoryOption } from '../contracts/products';", '',
        'export type CategoryFilterProps = { value: string; options: CategoryOption[]; onChange: (category: string) => void };', '',
        '/** @path-stub catalog.component.CategoryFilter -- the filter labelled "Category". */',
        `export function CategoryFilterView({ value, options, onChange }: CategoryFilterProps): JSX.Element ${b}`, '',
        "export const CategoryFilter = defineComponent<CategoryFilterProps>('CategoryFilter', CategoryFilterView);", '']) },
    'cart.domain.addLine': { file: 'features/cart/domain/addLine.ts', fn: 'addLineBody', export: 'addLine', layer: 'domain',
      source: (b) => stub([`import { defineDomain } from '${lib}/factories';`, "import type { CartLine } from '../contracts/cart';", '',
        '/** @path-stub cart.domain.addLine -- the cart lines after adding `quantity` of product `id`. */',
        `export function addLineBody({ lines, id, quantity }: { lines: CartLine[]; id: string; quantity: number }): CartLine[] ${b}`, '',
        "export const addLine = defineDomain<{ lines: CartLine[]; id: string; quantity: number }, CartLine[]>('addLine', addLineBody);", '']) },
    'cart.domain.itemCount': { file: 'features/cart/domain/itemCount.ts', fn: 'itemCountBody', export: 'itemCount', layer: 'domain',
      source: (b) => stub([`import { defineDomain } from '${lib}/factories';`, "import type { CartLine } from '../contracts/cart';", '',
        '/** @path-stub cart.domain.itemCount -- how many items the cart holds. */',
        `export function itemCountBody({ lines }: { lines: CartLine[] }): number ${b}`, '',
        "export const itemCount = defineDomain<{ lines: CartLine[] }, number>('itemCount', itemCountBody);", '']) },
    'cart.domain.cartLinkLabel': { file: 'features/cart/domain/cartLinkLabel.ts', fn: 'cartLinkLabelBody', export: 'cartLinkLabel', layer: 'domain',
      source: (b) => stub([`import { defineDomain } from '${lib}/factories';`, '',
        '/** @path-stub cart.domain.cartLinkLabel -- the cart link\'s text. */',
        `export function cartLinkLabelBody({ count }: { count: number }): string ${b}`, '',
        "export const cartLinkLabel = defineDomain<{ count: number }, string>('cartLinkLabel', cartLinkLabelBody);", '']) },
    'cart.service.loadCart': { file: 'features/cart/services/loadCart.ts', fn: 'loadCartBody', export: 'loadCart', layer: 'service',
      source: (b) => stub([`import { defineService } from '${lib}/factories';`, "import type { CartLine, CartStorage } from '../contracts/cart';", '',
        '/** @path-stub cart.service.loadCart -- the saved cart lines, read through the storage contract. */',
        `export function loadCartBody({ storage }: { storage: CartStorage }): CartLine[] ${b}`, '',
        "export const loadCart = defineService<{ storage: CartStorage }, CartLine[]>('loadCart', loadCartBody);", '']) },
    'cart.service.saveCart': { file: 'features/cart/services/saveCart.ts', fn: 'saveCartBody', export: 'saveCart', layer: 'service',
      source: (b) => stub([`import { defineService } from '${lib}/factories';`, "import type { CartLine, CartStorage } from '../contracts/cart';", '',
        '/** @path-stub cart.service.saveCart -- keeps the cart lines through the storage contract. */',
        `export function saveCartBody({ storage, lines }: { storage: CartStorage; lines: CartLine[] }): void ${b}`, '',
        "export const saveCart = defineService<{ storage: CartStorage; lines: CartLine[] }, void>('saveCart', saveCartBody);", '']) },
    'cart.component.CartLink': { file: 'features/cart/components/CartLink.tsx', fn: 'CartLinkView', export: 'CartLink', layer: 'component',
      source: (b) => stub(["'use client';", "import Link from 'next/link';", `import { defineComponent } from '${lib}/factories';`, '',
        'export type CartLinkProps = { label: string };', '',
        '/** @path-stub cart.component.CartLink -- the header link to the cart. */',
        `export function CartLinkView({ label }: CartLinkProps): JSX.Element ${b}`, '',
        "export const CartLink = defineComponent<CartLinkProps>('CartLink', CartLinkView);", '']) },
    'product.component.AddToCart': { file: 'features/product/components/AddToCart.tsx', fn: 'AddToCartView', export: 'AddToCart', layer: 'component',
      source: (b) => stub(["'use client';", "import { useState } from 'react';", `import { defineComponent } from '${lib}/factories';`, '',
        'export type AddToCartProps = { onAdd: (quantity: number) => void };', '',
        '/** @path-stub product.component.AddToCart -- the Quantity field and the Add to cart button. */',
        `export function AddToCartView({ onAdd }: AddToCartProps): JSX.Element ${b}`, '',
        "export const AddToCart = defineComponent<AddToCartProps>('AddToCart', AddToCartView);", '']) },
  };
  void factories;
  return files;
}

/** The wiring files (blocks write these; no stub inside): path -> source. */
function wiringFiles(specText) {
  const add = derive.addToCart(specText);
  return {
    'features/catalog/contracts/products.ts': `import products from '../../../library/fixtures/products.json';

export type Product = { id: string; name: string; category: string; price: number; description: string; stock: number };
export type CategoryOption = { value: string; label: string };
/** The products contract: where products come from. */
export type ProductsContract = { getProducts(): Product[] };
/** The real contract: the fixture file (the shop has no backend). */
export const productsApi: ProductsContract = { getProducts: () => products as Product[] };
`,
    'features/catalog/pages/CatalogPage.tsx': `'use client';
// @line-base pages/ListPage
// @line-route /
import Link from 'next/link';
import { useState } from 'react';
import { ListPage } from '../../../library/pages/ListPage';
import { definePage } from '../../../library/contracts/factories';
import { productsApi } from '../contracts/products';
import { listProducts } from '../services/listProducts';
import { categoryOptions } from '../domain/categoryOptions';
import { filterByCategory } from '../domain/filterByCategory';
import { CategoryFilter } from '../components/CategoryFilter';

const money = (n: number) => \`$\${n.toFixed(2)}\`;

function CatalogPageView(_props: Record<string, unknown>): JSX.Element {
  const products = listProducts({ api: productsApi });
  const [category, setCategory] = useState('All');
  const options = categoryOptions({ products });
  const visible = filterByCategory({ products, category });
  return (
    <ListPage title="Products" toolbar={<CategoryFilter value={category} options={options} onChange={setCategory} />} empty={<p>No products found</p>}>
      {visible.length > 0 ? visible.map((item) => (
        <article key={item.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
          <h2 className="text-lg font-semibold"><Link href={\`/products/\${item.id}\`}>{item.name}</Link></h2>
          <p>{item.category}</p>
          <p>{money(item.price)}</p>
        </article>
      )) : null}
    </ListPage>
  );
}

export const CatalogPage = definePage<Record<string, unknown>>('CatalogPage', CatalogPageView);
`,
    'features/cart/contracts/cart.ts': `export type CartLine = { id: string; quantity: number };
/** The storage contract the cart is kept through. */
export type CartStorage = { read(key: string): string | null; write(key: string, value: string): void };
/** The real contract: the browser's localStorage (nothing on the server). */
export const browserStorage: CartStorage = {
  read: (key) => (typeof window === 'undefined' ? null : window.localStorage.getItem(key)),
  write: (key, value) => { if (typeof window !== 'undefined') window.localStorage.setItem(key, value); },
};
`,
    'features/cart/hooks/cartProvider.ts': `'use client';
import { useCallback, useEffect, useState } from 'react';
import { defineProvider } from '../../../library/contracts/provider';
import { browserStorage, type CartLine } from '../contracts/cart';
import { loadCart } from '../services/loadCart';
import { saveCart } from '../services/saveCart';
import { addLine } from '../domain/addLine';
import { itemCount } from '../domain/itemCount';

export type CartValue = { lines: CartLine[]; count: number; add: (id: string, quantity: number) => void };

/** The cart, shared by every page: loaded once from storage, saved on every change. */
const Cart = defineProvider<Record<string, unknown>, CartValue>('Cart', () => {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setLines(loadCart({ storage: browserStorage })); setLoaded(true); }, []);
  useEffect(() => { if (loaded) saveCart({ storage: browserStorage, lines }); }, [loaded, lines]);
  const add = useCallback((id: string, quantity: number) => setLines((ls) => addLine({ lines: ls, id, quantity })), []);
  return { lines, count: itemCount({ lines }), add };
});

export const CartProviderRoot = Cart.ProviderComponent;
export const useCartProvider = Cart.useProvider;
`,
    'features/cart/components/CartNav.tsx': `'use client';
import { defineComponent } from '../../../library/contracts/factories';
import { useCartProvider } from '../hooks/cartProvider';
import { cartLinkLabel } from '../domain/cartLinkLabel';
import { CartLink } from './CartLink';

function CartNavView(_props: Record<string, unknown>): JSX.Element {
  const { count } = useCartProvider();
  return <CartLink label={cartLinkLabel({ count })} />;
}

export const CartNav = defineComponent<Record<string, unknown>>('CartNav', CartNavView);
`,
    'features/product/pages/ProductPage.tsx': `'use client';
// @line-base pages/DetailPage
// @line-route /products/:id
import Link from 'next/link';
import { DetailPage } from '../../../library/pages/DetailPage';
import products from '../../../library/fixtures/products.json';
import { definePage } from '../../../library/contracts/factories';
import { useCartProvider } from '../../cart/hooks/cartProvider';
import { AddToCart } from '../components/AddToCart';

type Product = { id: string; name: string; category: string; price: number; description: string; stock: number };

const money = (n: number) => \`$\${n.toFixed(2)}\`;

function ProductPageView({ params }: { params: { id: string } }): JSX.Element {
  const cart = useCartProvider();
  const { id } = params;
  const item = (products as Product[]).find((entry) => entry.id === id);
  const back = <Link href="/">Back to Products</Link>;
  if (!item) {
    return <DetailPage title="Product not found" back={back} />;
  }
  return (
    <DetailPage title={item.name} back={back} aside={<AddToCart onAdd={(quantity) => cart.add(item.id, quantity)} />}>
      <p>{item.category}</p>
      <p>{money(item.price)}</p>
      <p>{item.description}</p>
    </DetailPage>
  );
}

export const ProductPage = definePage<{ params: { id: string } }>('ProductPage', ProductPageView);
`,
    'app/layout.tsx': `// @line-layout: the app shell. Line writes this file; change its slots with line.setLayoutSlot.
import type { ReactNode } from 'react';
import './globals.css';
import { AppLayout } from '../library/components/AppLayout';
import { CartProviderRoot } from '../features/cart/hooks/cartProvider';
import { CartNav } from '../features/cart/components/CartNav';

export const metadata = { title: 'Shop' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <CartProviderRoot>
          <AppLayout nav={<CartNav />}>{children}</AppLayout>
        </CartProviderRoot>
      </body>
    </html>
  );
}
`,
    'line/path/harness/cartPath.tsx': `'use client';
// #921: the CART-1 path end to end, as a page sees it: the provider, the header's cart link and the product page.
import { CartProviderRoot } from '../../../features/cart/hooks/cartProvider';
import { CartNav } from '../../../features/cart/components/CartNav';
import { ProductPage } from '../../../features/product/pages/ProductPage';

export function CartPathHarness({ id }: { id: string }) {
  return (
    <CartProviderRoot>
      <CartNav />
      <ProductPage params={{ id }} />
    </CartProviderRoot>
  );
}
`,
    _add: add,
  };
}

/** Reference bodies (tests and the report's equivalence check only). */
export const REFERENCE = Object.freeze({
  'catalog.domain.categoryOptions': "{\n  const seen: string[] = [];\n  for (const p of products) if (!seen.includes(p.category)) seen.push(p.category);\n  return [{ value: 'All', label: 'All' }, ...seen.map((c) => ({ value: c, label: c }))];\n}",
  'catalog.domain.filterByCategory': "{\n  return category === 'All' ? products : products.filter((p) => p.category === category);\n}",
  'catalog.service.listProducts': '{\n  return api.getProducts();\n}',
  'catalog.component.CategoryFilter': '{\n  return (\n    <label>\n      Category\n      <select value={value} onChange={(e) => onChange(e.target.value)}>\n        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}\n      </select>\n    </label>\n  );\n}',
  'cart.domain.addLine': '{\n  const hit = lines.find((l) => l.id === id);\n  if (hit) return lines.map((l) => (l.id === id ? { ...l, quantity: l.quantity + quantity } : l));\n  return [...lines, { id, quantity }];\n}',
  'cart.domain.itemCount': '{\n  return lines.reduce((n, l) => n + l.quantity, 0);\n}',
  'cart.domain.cartLinkLabel': '{\n  return `Cart (${count})`;\n}',
  'cart.service.loadCart': "{\n  const raw = storage.read('cart');\n  if (!raw) return [];\n  try {\n    const v = JSON.parse(raw);\n    return Array.isArray(v) ? v : [];\n  } catch {\n    return [];\n  }\n}",
  'cart.service.saveCart': "{\n  storage.write('cart', JSON.stringify(lines));\n}",
  'cart.component.CartLink': '{\n  return <Link href="/cart">{label}</Link>;\n}',
  'product.component.AddToCart': '{\n  const [quantity, setQuantity] = useState(1);\n  const [added, setAdded] = useState(false);\n  return (\n    <div>\n      <label htmlFor="qty">Quantity</label>\n      <input id="qty" type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} />\n      <button type="button" onClick={() => { onAdd(quantity); setAdded(true); }}>Add to cart</button>\n      {added ? <p role="status">Added to cart</p> : null}\n    </div>\n  );\n}',
});

/**
 * The path: units (stubs and wiring), edges, examples per stub (with how each was derived) and each point's end-to-end
 * render examples.
 * @param {string} specText SPEC.md
 * @param {any[]} products the fixture rows
 */
export function buildPath(specText, products) {
  const cats = derive.categoryList(specText);
  const named = cats.filter((c) => c !== 'All');
  const opt = (c) => ({ value: c, label: c });
  const names = (rows) => rows.map((p) => p.name);
  const ids = (rows) => rows.map((p) => p.id);
  const { label, n } = derive.cartLabel(specText);
  const two = derive.twoLines(specText, products);
  const add = derive.addToCart(specText);
  const savedTwo = JSON.stringify(two);
  const S = stubFiles();
  const u = (id, extra) => ({ id, kind: 'stub', ...S[id], source: undefined, ...extra });
  const units = [
    u('catalog.domain.categoryOptions', { point: 'CAT-2', deps: [], context: `CAT-2: ${pointText(specText, 'CAT-2')} Type: Product = { id: string; name: string; category: string; price: number; description: string; stock: number }; CategoryOption = { value: string; label: string }.`,
      examples: [
        { id: 'opts-1', derivedBy: 'derive.categoryList: the list CAT-2 says the filter offers, each as {value, label}', input: { products }, expect: cats.map(opt), show: { input: '{ products: <the 12 fixture products> }', expect: JSON.stringify(cats.map(opt)) } },
        { id: 'opts-2', derivedBy: 'All, then only the categories present in the input (one category -> All + it)', input: { products: derive.rowsOf(specText, products, named[1]) }, expect: [opt('All'), opt(named[1])], show: { input: `{ products: <the 4 ${named[1]} products> }`, expect: JSON.stringify([opt('All'), opt(named[1])]) } },
      ] }),
    u('catalog.domain.filterByCategory', { point: 'CAT-2', deps: [], context: `CAT-2: ${pointText(specText, 'CAT-2')} Type: Product = { id: string; name: string; category: string; price: number; description: string; stock: number }. Return the matching Product objects themselves, in input order.`,
      examples: ['All', ...named].map((c, i) => ({ id: `filter-${i + 1}`, derivedBy: `derive.rowsOf: fixture rows ${c === 'All' ? '(all, CAT-2 "All shows all 12")' : `with category ${c} (CAT-2 "only its 4 products")`}, compared by id`, compare: 'ids',
        input: { products, category: c }, expect: ids(derive.rowsOf(specText, products, c)), show: { input: `{ products: <the 12 fixture products>, category: "${c}" }`, expect: `the products with ids ${JSON.stringify(ids(derive.rowsOf(specText, products, c)))}` } })) }),
    u('catalog.service.listProducts', { point: 'CAT-2', deps: [], context: 'ProductsContract = { getProducts(): Product[] }. The service returns every product the contract gives.',
      examples: [{ id: 'list-1', derivedBy: 'contract mock: getProducts answers the fixture file; expect every row (CAT-1 lists all 12), one call', compare: 'ids', input: { api: { $mock: { getProducts: { returns: products } } } }, expect: ids(products), calls: [['getProducts']], show: { input: '{ api: <mock whose getProducts() returns the 12 fixture products> }', expect: `the 12 products (ids ${JSON.stringify(ids(products))}), calling api.getProducts() once` } }] }),
    u('catalog.component.CategoryFilter', { point: 'CAT-2', deps: [], check: 'dom', context: `CAT-2: ${pointText(specText, 'CAT-2')} Render a native <select> labelled "Category" (a <label> around it or htmlFor) with one <option> per option (value = option.value, text = option.label), selected = value; on change call onChange(the chosen value).`,
      examples: [
        { id: 'filter-ui-1', derivedBy: 'render: the control labelled "Category" offers every derive.categoryList option', props: { value: 'All', options: cats.map(opt), onChange: { $spy: 'onChange' } }, steps: [{ expect: { role: 'combobox', name: 'Category' } }, ...cats.map((c) => ({ expect: { role: 'option', name: c } }))], show: { input: `{ value: "All", options: ${JSON.stringify(cats.map(opt))}, onChange }`, expect: `a control labelled "Category" with options ${cats.join(', ')}` } },
        { id: 'filter-ui-2', derivedBy: `choosing ${named[1]} reports it (CAT-2 "choosing a category")`, props: { value: 'All', options: cats.map(opt), onChange: { $spy: 'onChange' } }, steps: [{ choose: { label: 'Category', option: named[1] } }, { expectCalls: { spy: 'onChange', calls: [[named[1]]] } }], show: { input: '{ value: "All", options: <same>, onChange }', expect: `choosing "${named[1]}" calls onChange("${named[1]}") once` } },
      ] }),
    { id: 'catalog.contract.products', kind: 'wiring', layer: 'contract', file: 'features/catalog/contracts/products.ts', export: 'productsApi', point: 'CAT-2' },
    { id: 'catalog.page.CatalogPage', kind: 'wiring', layer: 'page', file: 'features/catalog/pages/CatalogPage.tsx', export: 'CatalogPage', point: 'CAT-2' },
    u('cart.domain.addLine', { point: 'CART-1', deps: [], context: `PROD-2: ${pointText(specText, 'PROD-2')} CartLine = { id: string; quantity: number }. Adding a product already in the cart raises its quantity; a new product is a new line at the end. Do not change the input array.`,
      examples: [
        { id: 'add-1', derivedBy: 'PROD-2 "add that many of the product": empty cart + 2 of the first line', input: { lines: [], id: two[0].id, quantity: two[0].quantity }, expect: [two[0]] },
        { id: 'add-2', derivedBy: 'a second product is a new line', input: { lines: [two[0]], id: two[1].id, quantity: 1 }, expect: two },
        { id: 'add-3', derivedBy: 'the same product again raises its quantity', input: { lines: [two[0]], id: two[0].id, quantity: 1 }, expect: [{ id: two[0].id, quantity: two[0].quantity + 1 }] },
      ] }),
    u('cart.domain.itemCount', { point: 'CART-1', deps: [], context: `CART-1: ${pointText(specText, 'CART-1')} CartLine = { id: string; quantity: number }.`,
      examples: [
        { id: 'count-1', derivedBy: 'an empty cart holds 0 items', input: { lines: [] }, expect: 0 },
        { id: 'count-2', derivedBy: `derive.twoLines: CART-1's "Cart (${n})" as two lines, quantities ${two[0].quantity} + 1`, input: { lines: two }, expect: n },
      ] }),
    u('cart.domain.cartLinkLabel', { point: 'CART-1', deps: [], context: `CART-1: ${pointText(specText, 'CART-1')}`,
      examples: [
        { id: 'label-1', derivedBy: `derive.cartLabel: CART-1's example "${label(n)}"`, input: { count: n }, expect: label(n) },
        { id: 'label-2', derivedBy: 'the same template for an empty cart', input: { count: 0 }, expect: label(0) },
      ] }),
    u('cart.service.loadCart', { point: 'CART-1', deps: [], context: 'CartStorage = { read(key: string): string | null; write(key: string, value: string): void }. The cart is saved under the key "cart" as the JSON of its lines; nothing saved means an empty cart.',
      examples: [
        { id: 'load-1', derivedBy: 'contract mock: read("cart") answers the JSON of derive.twoLines (CART-7 "kept after the page is reloaded")', input: { storage: { $mock: { read: { byArg: { cart: savedTwo } }, write: {} } } }, expect: two, calls: [['read', 'cart']], show: { input: `{ storage: <mock whose read("cart") returns '${savedTwo}'> }`, expect: `${savedTwo}, calling storage.read("cart") once` } },
        { id: 'load-2', derivedBy: 'contract mock: nothing saved (read answers null) -> empty cart', input: { storage: { $mock: { read: { returns: null }, write: {} } } }, expect: [], calls: [['read', 'cart']], show: { input: '{ storage: <mock whose read("cart") returns null> }', expect: '[], calling storage.read("cart") once' } },
      ] }),
    u('cart.service.saveCart', { point: 'CART-1', deps: [], context: 'CartStorage = { read(key: string): string | null; write(key: string, value: string): void }. Save the lines under the key "cart" as JSON.stringify(lines).',
      examples: [{ id: 'save-1', derivedBy: 'contract mock records write("cart", JSON of derive.twoLines)', input: { storage: { $mock: { read: {}, write: {} } }, lines: two }, expect: null, calls: [['write', 'cart', savedTwo]], show: { input: `{ storage: <recording mock>, lines: ${savedTwo} }`, expect: `returns nothing; calls storage.write("cart", '${savedTwo}') once` } }] }),
    u('cart.component.CartLink', { point: 'CART-1', deps: [], check: 'dom', context: `CART-1: ${pointText(specText, 'CART-1')} Render a next/link Link to "/cart" whose text is label.`,
      examples: [
        { id: 'link-1', derivedBy: `render: CART-1's "${label(n)}" opens /cart`, props: { label: label(n) }, steps: [{ expect: { role: 'link', name: label(n), href: '/cart' } }], show: { input: `{ label: "${label(n)}" }`, expect: `a link named "${label(n)}" with href "/cart"` } },
        { id: 'link-2', derivedBy: 'render: the label is shown as given', props: { label: label(0) }, steps: [{ expect: { role: 'link', name: label(0), href: '/cart' } }], show: { input: `{ label: "${label(0)}" }`, expect: `a link named "${label(0)}" with href "/cart"` } },
      ] }),
    u('product.component.AddToCart', { point: 'CART-1', deps: [], check: 'dom', context: `PROD-2: ${pointText(specText, 'PROD-2')} Keep the quantity in useState (start ${add.defaultQty}); render an <input type="number"> labelled "${add.field}" (a <label htmlFor> or around it), a <button> "${add.button}" that calls onAdd(quantity), and after a click the text "${add.status}" (e.g. <p role="status">).`,
      examples: [
        { id: 'add-ui-1', derivedBy: `PROD-2: a field "${add.field}" with default ${add.defaultQty} and a button "${add.button}"`, props: { onAdd: { $spy: 'onAdd' } }, steps: [{ expect: { role: 'spinbutton', name: add.field, value: add.defaultQty } }, { expect: { role: 'button', name: add.button } }], show: { input: '{ onAdd }', expect: `a number field labelled "${add.field}" with value ${add.defaultQty}, and a button "${add.button}"` } },
        { id: 'add-ui-2', derivedBy: `PROD-2: a click adds the default ${add.defaultQty} and says "${add.status}"`, props: { onAdd: { $spy: 'onAdd' } }, steps: [{ click: { name: add.button } }, { expectCalls: { spy: 'onAdd', calls: [[add.defaultQty]] } }, { expectText: add.status }], show: { input: '{ onAdd }', expect: `clicking "${add.button}" calls onAdd(${add.defaultQty}) and shows "${add.status}"` } },
        { id: 'add-ui-3', derivedBy: `PROD-2 "add that many": quantity ${n} then a click calls onAdd(${n})`, props: { onAdd: { $spy: 'onAdd' } }, steps: [{ fill: { label: add.field, value: n } }, { click: { name: add.button } }, { expectCalls: { spy: 'onAdd', calls: [[n]] } }], show: { input: '{ onAdd }', expect: `typing ${n} in "${add.field}" then clicking "${add.button}" calls onAdd(${n})` } },
      ] }),
    { id: 'cart.contract.storage', kind: 'wiring', layer: 'contract', file: 'features/cart/contracts/cart.ts', export: 'browserStorage', point: 'CART-1' },
    { id: 'cart.provider.Cart', kind: 'wiring', layer: 'provider', file: 'features/cart/hooks/cartProvider.ts', export: 'CartProviderRoot', point: 'CART-1' },
    { id: 'cart.provider.useCart', kind: 'wiring', layer: 'provider', file: 'features/cart/hooks/cartProvider.ts', export: 'useCartProvider', point: 'CART-1' },
    { id: 'cart.component.CartNav', kind: 'wiring', layer: 'component', file: 'features/cart/components/CartNav.tsx', export: 'CartNav', point: 'CART-1' },
    { id: 'product.page.ProductPage', kind: 'wiring', layer: 'page', file: 'features/product/pages/ProductPage.tsx', export: 'ProductPage', point: 'CART-1' },
    { id: 'app.layout', kind: 'wiring', layer: 'layout', file: 'app/layout.tsx', export: 'default', point: 'CART-1' },
  ];
  const edges = [
    ['catalog.page.CatalogPage', 'catalog.contract.products'], ['catalog.page.CatalogPage', 'catalog.service.listProducts'], ['catalog.page.CatalogPage', 'catalog.domain.categoryOptions'],
    ['catalog.page.CatalogPage', 'catalog.domain.filterByCategory'], ['catalog.page.CatalogPage', 'catalog.component.CategoryFilter'],
    ['cart.provider.Cart', 'cart.contract.storage'], ['cart.provider.Cart', 'cart.service.loadCart'], ['cart.provider.Cart', 'cart.service.saveCart'], ['cart.provider.Cart', 'cart.domain.addLine'], ['cart.provider.Cart', 'cart.domain.itemCount'],
    ['cart.component.CartNav', 'cart.provider.useCart'], ['cart.component.CartNav', 'cart.domain.cartLinkLabel'], ['cart.component.CartNav', 'cart.component.CartLink'],
    ['product.page.ProductPage', 'cart.provider.useCart'], ['product.page.ProductPage', 'product.component.AddToCart'],
    ['app.layout', 'cart.provider.Cart'], ['app.layout', 'cart.component.CartNav'],
  ].map(([from, to]) => ({ from, to }));
  const second = products[9];
  // The visual diff per point: the page's states to snapshot, and the change the point predicts between before and after.
  const visual = {
    'CAT-2': { file: 'features/catalog/pages/CatalogPage.tsx', export: 'CatalogPage', props: {},
      states: [{ label: 'opened', steps: [] }, { label: `chose ${named[1]}`, steps: [{ choose: { label: 'Category', option: named[1] } }] }],
      expect: [{ appears: { state: 0, role: 'combobox', name: 'Category' } }, { count: { state: 1, role: 'link', to: derive.rowsOf(specText, products, named[1]).length } }],
      derivedBy: `CAT-2: a "Category" control appears; choosing ${named[1]} narrows the product links to its ${derive.categoryCounts(specText).each}` },
    'CART-1': { file: 'line/path/harness/cartPath.tsx', export: 'CartPathHarness', props: { id: second.id },
      states: [{ label: 'opened', steps: [] }, { label: `added ${n - 1}`, steps: [{ fill: { label: add.field, value: n - 1 } }, { click: { name: add.button } }] }],
      expect: [{ appears: { state: 0, role: 'link', name: label(0) } }, { appears: { state: 1, role: 'link', name: label(n - 1) } }],
      derivedBy: `CART-1: a "${label(0)}" link appears; adding ${n - 1} makes it "${label(n - 1)}"` },
  };
  const points = {
    'CAT-2': { visual: visual['CAT-2'], e2e: { file: 'features/catalog/pages/CatalogPage.tsx', export: 'CatalogPage', examples: [{
      id: 'cat2-e2e', derivedBy: 'CAT-2 end to end: each derive.categoryList category shows derive.rowsOf its rows as product links, All shows all again', props: {},
      steps: [{ expectLinks: { present: names(products) } }, ...named.map((c) => ({ choose: { label: 'Category', option: c } })).flatMap((s, i) => [s, { expectLinks: { present: names(derive.rowsOf(specText, products, named[i])), absent: names(products.filter((p) => p.category !== named[i])) } }]),
        { choose: { label: 'Category', option: 'All' } }, { expectLinks: { present: names(products) } }] }] } },
    'CART-1': { visual: visual['CART-1'], e2e: { file: 'line/path/harness/cartPath.tsx', export: 'CartPathHarness', examples: [{
      id: 'cart1-e2e', derivedBy: `CART-1 end to end: "${label(0)}" at first; ${n - 1} of ${second.name} added on its page -> "${label(n - 1)}"; a reload (remount, storage kept) still shows it`, props: { id: second.id },
      steps: [{ expect: { role: 'link', name: label(0), href: '/cart' } }, { fill: { label: add.field, value: n - 1 } }, { click: { name: add.button } }, { expectText: add.status },
        { expect: { role: 'link', name: label(n - 1), href: '/cart' } }, { remount: true }, { expect: { role: 'link', name: label(n - 1), href: '/cart' } }] }] } },
  };
  return { version: 1, built: 'bench/ecommerce/driver/path-points.mjs', points, units, edges };
}

/** The typed-contracts copy for a project: `.ts` import suffixes dropped; the JSX shim only under @types/react 19+. */
function contractsFiles(root) {
  let major = 18;
  try { major = Number(JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@types/react/package.json'), 'utf8')).version.split('.')[0]); } catch { /* the starter pins 18 */ }
  const out = {};
  for (const f of fs.readdirSync(CONTRACTS_SRC)) {
    if (!/\.ts$/.test(f) || (f === 'jsx-global.d.ts' && major < 19)) continue;
    let src = fs.readFileSync(path.join(CONTRACTS_SRC, f), 'utf8').replace(/(from\s+'\.\/[\w-]+)\.ts'/g, "$1'");
    if (major < 19) src = src.replace(/^\/\/\/ <reference path="\.\/jsx-global\.d\.ts" \/>\n/m, '');
    out[`${CONTRACTS_DIR}/${f}`] = src;
  }
  return out;
}

/**
 * Install the path into a (seeded) project: contracts copy, stubs (placeholder bodies), wiring, path.json.
 * @param {string} root
 * @param {{specText?: string, bodies?: Record<string, string>}} [o] `bodies` fills stubs at once (tests: REFERENCE)
 * @returns {{files: string[], path: object}}
 */
export function installPath(root, { specText = fs.readFileSync(path.join(here, '..', 'SPEC.md'), 'utf8'), bodies = {} } = {}) {
  const products = JSON.parse(fs.readFileSync(path.join(root, FIXTURE), 'utf8'));
  const p = buildPath(specText, products);
  const files = { ...contractsFiles(root) };
  const { _add, ...wiring } = wiringFiles(specText);
  Object.assign(files, wiring);
  for (const [id, s] of Object.entries(stubFiles())) files[s.file] = s.source(bodies[id] ?? placeholderBody(id));
  files[PATH_FILE] = `${JSON.stringify(p, null, 1)}\n`;
  for (const [rel, src] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), src);
  }
  return { files: Object.keys(files), path: p };
}
