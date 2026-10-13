// #919 -- the code the seed's behaviour blocks write: a few small, fixed templates filled only with what the spec's
// points quote (labels, messages, routes, the shipping rule) and the fixture's fields. No model, nothing guessed: an
// input a template needs and the spec does not give means the block is not seeded (atomSteps.mjs leaves it open).
//
//   filter-sort  filterUsecase + catalogWithFilters  a usecase over the filter-sort atom; the wired list page gets the
//                                                    filter (library Select), the search (TextField) and the empty text
//   cart         cartService, cartUsecase, cartLink, addToCart, productWithAdd, cartPage  the browser cart
//                (localStorage, a same-tab change signal), its totals, the nav link, the add control, the cart page
//   checkout     ordersService, orderUsecase (validated-submit atom), checkoutPage, confirmationPage
// Every page keeps the @line-base/@line-route lines it has on disk (`head`).
// #933: these are the shop example's block templates; atomSteps.mjs reaches them only through a recipe in
// examples/shop.json (its `templates`), never by name, so a spec in other words lands none of them.
import path from 'node:path';

const posix = path.posix;
const noExt = (f) => f.replace(/\.(tsx?|jsx?|mjs)$/, '');
/**
 * The import specifier of `to` (a project file) from `from` (a project file), without the extension.
 * @param {string} from @param {string} to
 * @returns {string}
 */
export const spec = (from, to) => { const r = posix.relative(posix.dirname(from), noExt(to)); return r.startsWith('.') ? r : `./${r}`; };
const str = (s) => JSON.stringify(String(s));
const jsx = (s) => String(s).replace(/[{}<>]/g, '');
const setter = (k) => `set${k[0].toUpperCase()}${k.slice(1)}`;
/**
 * The hook name of a usecase function: filterProducts -> useFilterProducts.
 * @param {string} fn
 * @returns {string}
 */
export const hookName = (fn) => `use${fn[0].toUpperCase()}${fn.slice(1)}`;
const MONEY = 'const money = (n: number) => `$${n.toFixed(2)}`;';

/**
 * A usecase over the filter-sort atom: the rows the list shows for a filter value and a search text.
 * @param {{file: string, atomFile: string, fn: string, filterKey: string|null, searchKey: string|null}} o
 * @returns {string}
 */
export function filterUsecase(o) {
  const args = [o.filterKey ? `${o.filterKey}: string` : null, o.searchKey ? 'search: string' : null].filter(Boolean).join('; ');
  return [
    '// The list\'s filter and search: the filter-sort atom (an "all" filter value means no filter; the search ignores case),',
    '// and the hook a page holds them in.',
    "import { useState } from 'react';",
    `import { filterSort } from '${spec(o.file, o.atomFile)}';`,
    '',
    `export function ${o.fn}<T extends Record<string, unknown>>(rows: T[], view: { ${args} }): T[] {`,
    `  return filterSort(rows, { filters: { ${o.filterKey ? `${o.filterKey}: view.${o.filterKey}` : ''} }, search: ${o.searchKey ? 'view.search' : "''"}, searchFields: [${o.searchKey ? str(o.searchKey) : ''}] as (keyof T)[] });`,
    '}',
    '',
    `export function ${hookName(o.fn)}<T extends Record<string, unknown>>(rows: T[]) {`,
    ...(o.filterKey ? [`  const [${o.filterKey}, ${setter(o.filterKey)}] = useState('all');`] : []),
    ...(o.searchKey ? ["  const [search, setSearch] = useState('');"] : []),
    `  return { items: ${o.fn}(rows, { ${[o.filterKey, o.searchKey ? 'search' : null].filter(Boolean).join(', ')} }), ${[o.filterKey, o.filterKey ? setter(o.filterKey) : null, o.searchKey ? 'search, setSearch' : null].filter(Boolean).join(', ')} };`,
    '}',
    '',
  ].join('\n');
}

/**
 * The wired list page (basePage.mjs) with the filter, the search and the empty text, or null when `src` is not that page.
 * @param {string} src The page on disk.
 * @param {{file: string, lib: string, usecaseFile: string, fn: string, filter: {key: string, label: string, all: string,
 *   values: string[]}|null, search: {label: string}|null, empty: string|null}} o
 * @returns {string|null}
 */
export function catalogWithFilters(src, o) {
  const items = /^(\s*)const items = (\w+) as (\w+)\[\];$/m.exec(src);
  const empty = /\sempty=\{<p>[^<]*<\/p>\}/.exec(src);
  const open = /<(\w+) title=("[^"]*")/.exec(src);
  if (!items || !open || /^'use client';$/m.test(src)) return null;
  const imports = [
    o.filter ? `import { Select } from '${spec(o.file, `${o.lib}/components/Select`)}';` : null,
    o.search ? `import { TextField } from '${spec(o.file, `${o.lib}/components/TextField`)}';` : null,
    `import { ${hookName(o.fn)} } from '${spec(o.file, o.usecaseFile)}';`,
  ].filter(Boolean).join('\n');
  const names = ['items', o.filter ? o.filter.key : null, o.filter ? setter(o.filter.key) : null, o.search ? 'search, setSearch' : null].filter(Boolean).join(', ');
  const state = `${items[1]}const { ${names} } = ${hookName(o.fn)}(${items[2]} as ${items[3]}[]);`;
  const options = o.filter ? `[{ value: 'all', label: ${str(o.filter.all)} }, ${o.filter.values.map((v) => `{ value: ${str(v)}, label: ${str(v)} }`).join(', ')}]` : '';
  const toolbar = [
    o.filter ? `<Select label=${str(o.filter.label)} value={${o.filter.key}} onValueChange={${setter(o.filter.key)}} options={${options}} />` : null,
    o.search ? `<TextField label=${str(o.search.label)} type="search" value={search} onChange={setSearch} />` : null,
  ].filter(Boolean).join('');
  let out = src.replace(items[0], state).replace(open[0], `${open[0]} toolbar={<>${toolbar}</>}`);
  if (o.empty) out = empty ? out.replace(empty[0], ` empty={<p>${jsx(o.empty)}</p>}`) : out.replace(open[0], `${open[0]} empty={<p>${jsx(o.empty)}</p>}`);
  const lines = out.split('\n');
  let at = 0;
  while (at < lines.length && /^\s*\/\/\s*@line-/.test(lines[at])) at += 1;
  lines.splice(at, 0, "'use client';");
  const lastImport = lines.reduce((n, l, i) => (/^import /.test(l) ? i : n), -1);
  lines.splice(lastImport + 1, 0, imports);
  return lines.join('\n');
}

/**
 * The browser cart: lines {id, qty} in localStorage, a cached snapshot and a same-tab change signal (useSyncExternalStore).
 * @param {{storageKey: string}} o
 * @returns {string}
 */
export function cartService(o) {
  return `// The cart, kept in the browser (localStorage): its lines {id, qty}, read once and cached so a React store sees one
// snapshot per change, and a change signal for this tab (the storage event covers the others).
export type CartLine = { id: string; qty: number };

const KEY = ${str(o.storageKey)};
const EMPTY: CartLine[] = [];
const listeners = new Set<() => void>();
let cache: CartLine[] | null = null;

const isLine = (v: unknown): v is CartLine => typeof v === 'object' && v !== null && typeof (v as CartLine).id === 'string' && Number.isInteger((v as CartLine).qty) && (v as CartLine).qty > 0;

export function cartLines(): CartLine[] {
  if (cache) {
    return cache;
  }
  if (typeof window === 'undefined') {
    return EMPTY;
  }
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    cache = Array.isArray(saved) ? saved.filter(isLine) : [];
  } catch {
    cache = [];
  }
  return cache;
}

export function serverCartLines(): CartLine[] {
  return EMPTY;
}

function save(lines: CartLine[]): void {
  cache = lines;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    // Storage may be full or blocked; the cart still works for this page.
  }
  listeners.forEach((l) => l());
}

export function subscribeCart(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) {
      cache = null;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function addToCart(id: string, qty: number): void {
  const lines = cartLines();
  const had = lines.find((l) => l.id === id);
  save(had ? lines.map((l) => (l.id === id ? { id, qty: l.qty + qty } : l)) : [...lines, { id, qty }]);
}

export function setCartQty(id: string, qty: number): void {
  save(qty > 0 ? cartLines().map((l) => (l.id === id ? { id, qty } : l)) : cartLines().filter((l) => l.id !== id));
}

export function removeFromCart(id: string): void {
  save(cartLines().filter((l) => l.id !== id));
}

export function clearCart(): void {
  save([]);
}
`;
}

/**
 * #935: the import of a fixture as `rows`: from its file, or, when it belongs to another feature (`via`), through that
 * feature's public index (features/<name>/index.ts), the one way into another feature.
 * @param {string} file The importing file. @param {{rel: string, via?: {feature: string, name: string}}} f
 * @returns {string}
 */
function fixtureImport(file, f) {
  if (!f.via) return `import rows from '${spec(file, f.rel)}';`;
  const at = f.rel.indexOf(`/${f.via.feature}/`);
  const index = `${f.rel.slice(0, at + f.via.feature.length + 1)}/index`;
  return `import { ${f.via.name === 'rows' ? 'rows' : `${f.via.name} as rows`} } from '${spec(file, index)}';`;
}

/**
 * The cart as a page uses it: its items joined with the fixture, the totals (the spec's shipping rule) and the changes.
 * A based fixture keeps its rows under "value" (`wrapped`, #935 `{ "$lineBase": "fixtures/<name>", "value": [...] }`).
 * @param {{file: string, serviceFile: string, fixture: {rel: string, idKey: string, nameKey: string, amountKey: string, wrapped?: boolean, via?: {feature: string, name: string}},
 *   rule: {fee: number, freeFrom: number}|null}} o
 * @returns {string}
 */
export function cartUsecase(o) {
  const f = o.fixture;
  const ship = o.rule
    ? `  const shipping = items.length === 0 || subtotal >= ${o.rule.freeFrom} ? 0 : ${o.rule.fee};`
    : '  const shipping = 0;';
  return `// The cart for a page: each line with its ${f.nameKey} and ${f.amountKey} from ${posix.basename(f.rel)}, the item count, the subtotal,
// the shipping${o.rule ? ` (${o.rule.fee} under ${o.rule.freeFrom}, else free)` : ''} and the total, and the changes a page makes.
import { useSyncExternalStore } from 'react';
${fixtureImport(o.file, f)}
import { addToCart, cartLines, clearCart, removeFromCart, serverCartLines, setCartQty, subscribeCart } from '${spec(o.file, o.serviceFile)}';
import type { CartLine } from '${spec(o.file, o.serviceFile)}';

type Row = { ${f.idKey}: string; ${f.nameKey}: string; ${f.amountKey}: number };
export type CartItem = { id: string; name: string; price: number; qty: number; lineTotal: number };
export type CartSummary = { items: CartItem[]; count: number; subtotal: number; shipping: number; total: number };

const round = (n: number) => Math.round(n * 100) / 100;

export function cartSummary(lines: CartLine[]): CartSummary {
  const items: CartItem[] = [];
  for (const line of lines) {
    const row = (${f.wrapped ? '(rows as unknown as { value: Row[] }).value' : 'rows as Row[]'}).find((r) => r.${f.idKey} === line.id);
    if (row) {
      items.push({ id: line.id, name: row.${f.nameKey}, price: row.${f.amountKey}, qty: line.qty, lineTotal: round(row.${f.amountKey} * line.qty) });
    }
  }
  const count = items.reduce((n, i) => n + i.qty, 0);
  const subtotal = round(items.reduce((n, i) => n + i.lineTotal, 0));
${ship}
  return { items, count, subtotal, shipping, total: round(subtotal + shipping) };
}

export function useCart() {
  const lines = useSyncExternalStore(subscribeCart, cartLines, serverCartLines);
  return { ...cartSummary(lines), add: addToCart, setQty: setCartQty, remove: removeFromCart, clear: clearCart };
}
`;
}

/**
 * The cart link for the app shell's nav: "<label> (<count>)", to the cart route.
 * @param {{file: string, usecaseFile: string, label: string, route: string}} o
 * @returns {string}
 */
export function cartLink(o) {
  return `// @line-level molecule
'use client';
import Link from 'next/link';
import { useCart } from '${spec(o.file, o.usecaseFile)}';

export function CartLink() {
  const { count } = useCart();
  return <Link href=${str(o.route)}>${jsx(o.label)} ({count})</Link>;
}
`;
}

/**
 * The add-to-cart control: a quantity field (its default and minimum), the button and the status message.
 * @param {{file: string, lib: string, usecaseFile: string, qtyLabel: string, def: number, min: number, button: string, status: string}} o
 * @returns {string}
 */
export function addToCart(o) {
  return `// @line-level molecule
'use client';
import { useState } from 'react';
import { Button } from './Button';
import { TextField } from './TextField';
import { useCart } from '${spec(o.file, o.usecaseFile)}';

export type AddToCartProps = { id: string };

export function AddToCart({ id }: AddToCartProps) {
  const cart = useCart();
  const [qty, setQty] = useState(${str(o.def)});
  const [status, setStatus] = useState('');
  const add = () => {
    cart.add(id, Math.max(${o.min}, Math.floor(Number(qty)) || ${o.min}));
    setStatus(${str(o.status)});
  };
  return (
    <div className="flex flex-col gap-3">
      <TextField label=${str(o.qtyLabel)} type="number" min={${o.min}} value={qty} onChange={(v) => { setQty(v); setStatus(''); }} />
      <Button label=${str(o.button)} onClick={add} />
      <p role="status" aria-live="polite">{status}</p>
    </div>
  );
}
`;
}

/**
 * The wired detail page (basePage.mjs) with the add control as its aside, or null when `src` is not that page.
 * @param {string} src @param {{file: string, componentFile: string}} o
 * @returns {string|null}
 */
export function productWithAdd(src, o) {
  const id = /\(entry\) => entry\.(\w+) ===/.exec(src);
  const open = /<(\w+) title=\{item\.\w+\}/.exec(src);
  if (!id || !open) return null;
  const lines = src.replace(open[0], `${open[0]} aside={<AddToCart id={item.${id[1]}} />}`).split('\n');
  const lastImport = lines.reduce((n, l, i) => (/^import /.test(l) ? i : n), -1);
  lines.splice(lastImport + 1, 0, `import { AddToCart } from '${spec(o.file, o.componentFile)}';`);
  return lines.join('\n');
}

/** The summary rows (the three quoted totals labels; the middle one optional) as JSX lines. */
const summaryRows = ([sum, fee, total], ind) => [
  `${ind}<p className="flex justify-between"><span>${jsx(sum)}</span> <span>{money(cart.subtotal)}</span></p>`,
  ...(fee ? [`${ind}<p className="flex justify-between"><span>${jsx(fee)}</span> <span>{money(cart.shipping)}</span></p>`] : []),
  `${ind}<p className="flex justify-between font-semibold"><span>${jsx(total)}</span> <span>{money(cart.total)}</span></p>`,
];

/**
 * The cart page on the library list page: a line per item (name, unit price, quantity field, line total, remove), the
 * totals and the checkout link; the empty text instead when the cart is empty.
 * @param {{head: string, file: string, lib: string, usecaseFile: string, heading: string, qtyPrefix: string,
 *   removePrefix: string|null, labels: [string, string|null, string], empty: string,
 *   next: {label: string, route: string}|null}} o
 * @returns {string}
 */
export function cartPage(o) {
  return `${o.head}'use client';
import Link from 'next/link';
import { ListPage } from '${spec(o.file, `${o.lib}/pages/ListPage`)}';
import { Button } from '${spec(o.file, `${o.lib}/components/Button`)}';
import { TextField } from '${spec(o.file, `${o.lib}/components/TextField`)}';
import { useCart } from '${spec(o.file, o.usecaseFile)}';

${MONEY}

export function ${posix.basename(noExt(o.file))}() {
  const cart = useCart();
  return (
    <ListPage title=${str(o.heading)} empty={<p>${jsx(o.empty)}</p>}>
      {cart.items.length > 0 && (<>{cart.items.map((item) => (
        <article key={item.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
          <h2 className="text-lg font-semibold">{item.name}</h2>
          <p>{money(item.price)}</p>
          <TextField label={\`${o.qtyPrefix.replace(/[`$\\]/g, '')}\${item.name}\`} type="number" min={0} value={String(item.qty)} onChange={(v) => { const n = Number.parseInt(v, 10); if (!Number.isNaN(n)) { cart.setQty(item.id, n); } }} />
          <p>{money(item.lineTotal)}</p>
${o.removePrefix ? `          <Button variant="secondary" label={\`${o.removePrefix.replace(/[`$\\]/g, '')}\${item.name}\`} onClick={() => cart.remove(item.id)} />\n` : ''}        </article>
      ))}
        <section aria-label="Cart summary" className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4">
${summaryRows(o.labels, '          ').join('\n')}
${o.next ? `          <Link href=${str(o.next.route)}>${jsx(o.next.label)}</Link>\n` : ''}        </section>
      </>)}
    </ListPage>
  );
}
`;
}

/**
 * The mock order service: places an order in the app (no network) and keeps the last one for the confirmation page.
 * @returns {string}
 */
export function ordersService() {
  return `// The mock order service: an order is placed in the app (no network) and the last one is kept for this tab
// (sessionStorage) so the confirmation page can show it.
export type OrderLine = { id: string; name: string; qty: number; lineTotal: number };
export type Order = { number: string; lines: OrderLine[]; total: number };

const KEY = 'line-last-order';

export async function placeOrder(lines: OrderLine[], total: number): Promise<Order> {
  const order: Order = { number: String(Date.now()).slice(-8), lines, total };
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    // The confirmation then shows no details; the order is still placed.
  }
  return order;
}

export function lastOrder(): Order | null {
  try {
    return JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null') as Order | null;
  } catch {
    return null;
  }
}
`;
}

/**
 * The checkout usecase: the form's schema (the spec's rules and messages) through the validated-submit atom, then the
 * mock order service.
 * @param {{file: string, atomFile: string, serviceFile: string, fields: {key: string, label: string, rule: string,
 *   digits?: number, message: string}[], checkbox: {key: string, message: string}|null}} o
 * @returns {string}
 */
export function orderUsecase(o) {
  const keys = [...o.fields.map((f) => `${f.key}: string`), ...(o.checkbox ? [`${o.checkbox.key}: boolean`] : [])];
  const empty = [...o.fields.map((f) => `${f.key}: ''`), ...(o.checkbox ? [`${o.checkbox.key}: false`] : [])];
  const check = (f) => {
    const v = `values.${f.key}.trim()`;
    const bad = f.rule === 'email' ? `!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(${v})` : f.rule === 'digits' ? `!/^\\d{${f.digits}}$/.test(${v})` : `${v} === ''`;
    return `    if (${bad}) {\n      issues.push({ path: [${str(f.key)}], message: ${str(f.message)} });\n    }`;
  };
  return `// Checkout: the form's rules and messages as a schema, checked by the validated-submit atom before the order is placed
// through the mock order service; and the hooks the checkout and confirmation pages hold them in.
import { useEffect, useState } from 'react';
import { machine, validatedSubmit } from '${spec(o.file, o.atomFile)}';
import type { Issue, Schema, SubmitState } from '${spec(o.file, o.atomFile)}';
import { lastOrder, placeOrder } from '${spec(o.file, o.serviceFile)}';
import type { Order, OrderLine } from '${spec(o.file, o.serviceFile)}';

export type { Order, OrderLine };
export type OrderForm = { ${keys.join('; ')} };

export const EMPTY_ORDER_FORM: OrderForm = { ${empty.join(', ')} };

export const orderSchema: Schema<OrderForm, OrderForm> = {
  safeParse(values) {
    const issues: Issue[] = [];
${o.fields.map(check).join('\n')}
${o.checkbox ? `    if (!values.${o.checkbox.key}) {\n      issues.push({ path: [${str(o.checkbox.key)}], message: ${str(o.checkbox.message)} });\n    }\n` : ''}    return issues.length > 0 ? { success: false, error: { issues } } : { success: true, data: values };
  },
};

export function submitOrder(values: OrderForm, lines: OrderLine[], total: number): Promise<SubmitState<OrderForm, OrderForm, Order>> {
  return validatedSubmit(machine.init({ schema: orderSchema, values }) as SubmitState<OrderForm, OrderForm, Order>, () => placeOrder(lines, total));
}

export function useCheckoutForm(lines: OrderLine[], total: number, onPlaced: () => void) {
  const [values, setValues] = useState<OrderForm>(EMPTY_ORDER_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof OrderForm>(key: K) => (value: OrderForm[K]) => setValues((v) => ({ ...v, [key]: value }));
  const submit = () => {
    void submitOrder(values, lines, total).then((done) => {
      setErrors(done.errors);
      if (done.status === 'submitted') {
        onPlaced();
      }
    });
  };
  return { values, errors, set, submit };
}

export function useLastOrder(): Order | null {
  const [order, setOrder] = useState<Order | null>(null);
  useEffect(() => {
    setOrder(lastOrder());
  }, []);
  return order;
}
`;
}

/**
 * The checkout page on the library form page: the fields, the checkbox, the order summary beside them, the submit
 * button; the empty-cart text and a link to the products instead when the cart is empty.
 * @param {{head: string, file: string, lib: string, selectionUsecaseFile: string, usecaseFile: string, heading: string,
 *   button: string, fields: {key: string, label: string, rule: string}[], checkbox: {key: string, label: string}|null,
 *   labels: [string, string|null, string], empty: string, listRoute: string, next: string}} o
 * @returns {string}
 */
export function checkoutPage(o) {
  const name = posix.basename(noExt(o.file));
  const field = (f) => `      <TextField label=${str(f.label)}${f.rule === 'email' ? ' type="email"' : ''} value={values.${f.key}} onChange={set(${str(f.key)})} error={errors.${f.key}} />`;
  return `${o.head}'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormPage } from '${spec(o.file, `${o.lib}/pages/FormPage`)}';
import { TextField } from '${spec(o.file, `${o.lib}/components/TextField`)}';
${o.checkbox ? `import { Checkbox } from '${spec(o.file, `${o.lib}/components/Checkbox`)}';\n` : ''}import { useCart } from '${spec(o.file, o.selectionUsecaseFile)}';
import { useCheckoutForm } from '${spec(o.file, o.usecaseFile)}';

${MONEY}

export function ${name}() {
  const cart = useCart();
  const router = useRouter();
  const lines = cart.items.map((i) => ({ id: i.id, name: i.name, qty: i.qty, lineTotal: i.lineTotal }));
  const { values, errors, set, submit } = useCheckoutForm(lines, cart.total, () => {
    cart.clear();
    router.push(${str(o.next)});
  });
  if (cart.items.length === 0) {
    return (
      <main className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">${jsx(o.heading)}</h1>
        <p>${jsx(o.empty)}</p>
        <Link href=${str(o.listRoute)}>Back to products</Link>
      </main>
    );
  }
  const summary = (
    <section aria-label="Order summary" className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4">
      {cart.items.map((item) => (
        <p key={item.id} className="flex justify-between"><span>{item.name} x {item.qty}</span> <span>{money(item.lineTotal)}</span></p>
      ))}
${summaryRows(o.labels, '      ').join('\n')}
    </section>
  );
  return (
    <FormPage title=${str(o.heading)} submitLabel=${str(o.button)} onSubmit={submit} aside={summary}>
${o.fields.map(field).join('\n')}
${o.checkbox ? `      <Checkbox label=${str(o.checkbox.label)} checked={values.${o.checkbox.key}} onCheckedChange={set(${str(o.checkbox.key)})} error={errors.${o.checkbox.key}} />\n` : ''}    </FormPage>
  );
}
`;
}

/**
 * The order confirmation on the library detail page: the heading, the order number, the products and the total paid,
 * and the link back.
 * @param {{head: string, file: string, lib: string, usecaseFile: string, heading: string, numberPrefix: string,
 *   link: {label: string, route: string}}} o
 * @returns {string}
 */
export function confirmationPage(o) {
  return `${o.head}'use client';
import Link from 'next/link';
import { DetailPage } from '${spec(o.file, `${o.lib}/pages/DetailPage`)}';
import { useLastOrder } from '${spec(o.file, o.usecaseFile)}';

${MONEY}

export function ${posix.basename(noExt(o.file))}() {
  const order = useLastOrder();
  return (
    <DetailPage title=${str(o.heading)}>
      {order ? (
        <>
          <p>${jsx(o.numberPrefix)}{order.number}</p>
          <ul className="flex flex-col gap-1">
            {order.lines.map((line) => (
              <li key={line.id}>{line.name} x {line.qty}: {money(line.lineTotal)}</li>
            ))}
          </ul>
          <p>Total paid: {money(order.total)}</p>
        </>
      ) : null}
      <Link href=${str(o.link.route)}>${jsx(o.link.label)}</Link>
    </DetailPage>
  );
}
`;
}
