// #907: the source line.baseOn writes for a library PAGE. A route can serve every page it writes (it takes no props
// but params), and it already shows the feature's data when the library has a fixture for it, so a small model fills
// only what is left. Deterministic: everything comes from the library page's props, the library's array fixtures and
// the feature's spec.md text; nothing is project-specific.
//
//   list page   (library page named *List*, takes children)  + a matching array fixture -> one <article> per entry:
//               the name as a link to the detail route, the fields the spec mentions, money-formatted prices, an
//               `empty` state when the library page has one
//   detail page (library page named *Detail*, takes children) + a matching array fixture -> takes {params}, looks the
//               id up, shows the name as the title and the fields; "<Item> not found" and a link back when missing
//   any other page (or no fixture) -> renders the library page with its required props filled (title from the spec)
//
// The bench run data-qwen3-4b-r1 showed why: the old pass-through wrapper (props: ComponentProps<typeof X>) could
// not be served at a route and rendered nothing, so the model spent read + setCode + run on every page.
import fs from 'node:fs';
import path from 'node:path';
import { ts } from '@construct/ast/lazy';

const posix = path.posix;
const MONEY = /(price|cost|amount|total|fee)$/i;
const ID_KEYS = ['id', 'slug', 'key', 'sku', 'code'];
const NAME_KEYS = ['name', 'title', 'label'];

const words = (key) => String(key).split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean).map((w) => w.toLowerCase());
/** "submitLabel" -> "Submit label", "products" -> "Products". */
export const humanize = (key) => { const t = words(key).join(' '); return t.charAt(0).toUpperCase() + t.slice(1); };
const pascal = (key) => words(key).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
/** A plain English singular: products -> product, categories -> category, boxes -> box, news stays. */
export function singular(word) {
  const w = String(word);
  if (/ies$/i.test(w)) return `${w.slice(0, -3)}y`;
  if (/(s|x|z|ch|sh)es$/i.test(w)) return w.slice(0, -2);
  if (/[^s]s$/i.test(w)) return w.slice(0, -1);
  return w;
}
const plural = (w) => (/[^aeiou]y$/i.test(w) ? `${w.slice(0, -1)}ies` : /(s|x|z|ch|sh)$/i.test(w) ? `${w}es` : `${w}s`);
const jsxText = (s) => String(s).replace(/[{}<>]/g, '');
const attr = (s) => JSON.stringify(String(s));

/** The feature's spec.md text, or ''. */
function specText(root, layout, feature) {
  try { return fs.readFileSync(path.join(root, layout.features, feature, 'spec.md'), 'utf8'); } catch { return ''; }
}

/** Whether `text` mentions `key` (its words as a phrase, singular or plural, any case). */
function mentions(text, key) {
  const w = words(key);
  if (!w.length) return false;
  const last = w.at(-1);
  const forms = [...new Set([last, plural(last), singular(last)])].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const head = w.slice(0, -1).map((x) => `${x}[\\s_-]*`).join('');
  return new RegExp(`\\b${head}(?:${forms.join('|')})\\b`, 'i').test(text);
}

/**
 * The library's array fixtures (library/fixtures/*.json holding a non-empty array of objects).
 * @returns {{stem: string, rel: string, rows: Record<string, unknown>[]}[]}
 */
export function arrayFixtures(root, layout) {
  const dir = `${layout.library}/fixtures`;
  let names = [];
  try { names = fs.readdirSync(path.join(root, dir)).filter((n) => n.endsWith('.json')).sort(); } catch { return []; }
  const out = [];
  for (const n of names) {
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(root, dir, n), 'utf8')); } catch { continue; }
    if (Array.isArray(data) && data.length && data.every((r) => r && typeof r === 'object' && !Array.isArray(r))) out.push({ stem: n.slice(0, -5), rel: `${dir}/${n}`, rows: data });
  }
  return out;
}

/**
 * The array fixture that belongs to a feature: its name (or its singular) is the feature's name, or the spec mentions
 * it; the most mentions win, then the name. Null when none fits.
 */
export function fixtureFor(fixtures, feature, spec) {
  let best = null;
  for (const f of fixtures) {
    const forms = [f.stem, singular(f.stem)].map((x) => x.toLowerCase());
    let score = forms.includes(String(feature).toLowerCase()) ? 1000 : 0;
    const re = new RegExp(`\\b(?:${[...new Set(forms)].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
    score += (spec.match(re) || []).length;
    if (score > 0 && (!best || score > best.score)) best = { ...f, score };
  }
  return best;
}

/** The scalar fields of a fixture's rows, in first-seen key order: {key, type: 'string'|'number'|'boolean'}. */
function scalarFields(rows) {
  const out = new Map();
  for (const r of rows) for (const [k, v] of Object.entries(r)) {
    if (k.startsWith('$') || out.has(k) || v === null || v === undefined) continue;
    if (['string', 'number', 'boolean'].includes(typeof v)) out.set(k, typeof v);
  }
  return [...out].map(([key, type]) => ({ key, type }));
}

/**
 * The props a library page declares: [{name, optional, type}] from its exported function's first parameter (an inline
 * type literal, or a type alias or interface in the same file). Null when they cannot be read; [] when it takes none.
 */
export function pagePropsOf(src, libName) {
  const sf = ts.createSourceFile('page.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const locals = new Map();
  let fn = null;
  const visit = (node) => {
    if ((ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name) locals.set(node.name.text, node);
    if (ts.isFunctionDeclaration(node) && node.name?.text === libName) fn = node;
    if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === libName && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) fn = d.initializer;
    }
  };
  sf.statements.forEach(visit);
  if (!fn) return null;
  const param = fn.parameters[0];
  if (!param) return [];
  let type = param.type;
  if (!type) return null;
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const decl = locals.get(type.typeName.text);
    if (!decl) return null;
    type = ts.isInterfaceDeclaration(decl) ? decl : decl.type;
  }
  const members = ts.isTypeLiteralNode(type) || ts.isInterfaceDeclaration(type) ? type.members : null;
  if (!members) return null;
  return members.filter((m) => ts.isPropertySignature(m) && m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)))
    .map((m) => ({ name: m.name.text, optional: Boolean(m.questionToken), type: m.type ? m.type.getText(sf) : 'unknown' }));
}

/** A value for one required prop, as JSX attribute text (`title="Orders"`), or null when there is no safe one. */
function fillProp({ name, type }, title) {
  const t = type.replace(/\s+/g, ' ').trim();
  const lit = /^(['"])([^'"]*)\1/.exec(t);
  if (lit) return `${name}=${attr(lit[2])}`;
  if (/^string\b/.test(t)) {
    if (/^(title|heading|name)$/i.test(name)) return `${name}=${attr(title)}`;
    return `${name}=${attr(humanize(name.replace(/(Label|Text)$/, '')) || humanize(name))}`;
  }
  if (/=>/.test(t)) return `${name}={() => {}}`;
  if (/^number\b/.test(t)) return `${name}={0}`;
  if (/^boolean\b/.test(t)) return `${name}={false}`;
  if (/\[\]$|^Array</.test(t)) return `${name}={[]}`;
  if (/ReactNode|ReactElement|JSX\.Element/.test(t)) return `${name}={null}`;
  return null;
}

/** The project's Next.js major version (package.json), or 0. */
function nextMajor(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const v = pkg.dependencies?.next ?? pkg.devDependencies?.next ?? '';
    return Number((/(\d+)/.exec(String(v)) || [])[1] ?? 0);
  } catch { return 0; }
}

/**
 * The route a feature page already claims (@line-route) when it is based on a library page named like `kind` and reads
 * the same fixture, or null.
 */
function claimedRoute(root, layout, kind, wantParam, fixtureRel) {
  const fixtureName = posix.basename(fixtureRel);
  let features = [];
  try { features = fs.readdirSync(path.join(root, layout.features)); } catch { return null; }
  for (const f of features.sort()) {
    let pages = [];
    try { pages = fs.readdirSync(path.join(root, layout.features, f, 'pages')).sort(); } catch { continue; }
    for (const p of pages) {
      let src = '';
      try { src = fs.readFileSync(path.join(root, layout.features, f, 'pages', p), 'utf8'); } catch { continue; }
      const base = /@line-base\s+pages\/(\S+)/.exec(src);
      const route = /@line-route\s+(\S+)/.exec(src);
      if (!base || !route || !base[1].includes(kind) || !src.includes(`fixtures/${fixtureName}`)) continue;
      const param = /^(.*)\/:[A-Za-z][A-Za-z0-9_]*$/.exec(route[1]);
      if (wantParam && param) return param[1];
      if (!wantParam && !param) return route[1];
    }
  }
  return null;
}

/**
 * The page line.baseOn writes for a library page, or null when it is not a page.
 * @param {string} root
 * @param {{library: string, features: string}} layout
 * @param {{libraryId: string, feature: string, name: string, dest: string, libName: string, libSrc: string,
 *   spec: string, local: string, binding: string, typed: boolean}} o `spec` is the import specifier of the library
 *   page from `dest`; `local`/`binding` how it is imported.
 * @returns {string}
 */
export function basePageSource(root, layout, o) {
  const text = specText(root, layout, o.feature);
  const heading = (/^#\s+(.+)$/m.exec(text) || [])[1]?.trim();
  const props = pagePropsOf(o.libSrc, o.libName);
  const has = (n) => Boolean(props?.some((p) => p.name === n));
  const head = `// @line-base ${o.libraryId}\n`;
  const fixture = props && has('title') && has('children') ? fixtureFor(arrayFixtures(root, layout), o.feature, text) : null;
  const shape = /List/.test(o.libName) ? 'list' : /Detail/.test(o.libName) ? 'detail' : null;
  if (fixture && shape) {
    const wired = wiredPage(root, layout, o, { fixture, shape, text, props, has, head });
    if (wired) return wired;
  }
  // Any other page: the library page with its required props filled, so a route can serve it.
  const title = heading ? humanize(heading) : humanize(o.feature);
  const fills = (props ?? []).filter((p) => !p.optional && p.name !== 'children').map((p) => fillProp(p, title)).filter(Boolean);
  const client = fills.some((f) => f.includes('=> {}')) ? "'use client';\n" : '';
  return `${head}${client}import ${o.binding} from '${o.spec}';\n\nexport function ${o.name}() {\n  return <${o.local}${fills.map((f) => ` ${f}`).join('')} />;\n}\n`;
}

/** The list or detail page wired to `fixture`, or null when the fixture has no name field to show. */
function wiredPage(root, layout, o, { fixture, shape, text, props, has, head }) {
  const fields = scalarFields(fixture.rows);
  const id = ID_KEYS.map((k) => fields.find((f) => f.key === k)).find(Boolean) ?? fields.find((f) => /Id$/.test(f.key)) ?? null;
  const nameF = NAME_KEYS.map((k) => fields.find((f) => f.key === k && f.type === 'string')).find(Boolean)
    ?? fields.find((f) => f.type === 'string' && f !== id);
  if (!nameF || !id) return null;
  const rest = fields.filter((f) => f !== id && f !== nameF);
  const said = rest.filter((f) => mentions(text, f.key));
  const typed = o.typed;
  const Title = humanize(fixture.stem);
  const One = humanize(singular(fixture.stem));
  let Type = pascal(singular(fixture.stem)) || 'Entry';
  if ([o.name, o.local].includes(Type)) Type = `${Type}Entry`;
  const data = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(fixture.stem) && !['items', 'item', 'params', o.name, o.local, 'Link'].includes(fixture.stem) ? fixture.stem : 'rows';
  const used = [id, nameF, ...(shape === 'list' ? said : rest)];
  const money = used.some((f) => f.type === 'number' && MONEY.test(f.key));
  const show = (f, v) => (f.type === 'number' && MONEY.test(f.key) ? `{money(${v}.${f.key})}` : f.type === 'string' ? `{${v}.${f.key}}` : `{String(${v}.${f.key})}`);
  const fixtureSpec = (() => { const r = posix.relative(posix.dirname(o.dest), fixture.rel); return r.startsWith('.') ? r : `./${r}`; })();
  const detailPrefix = claimedRoute(root, layout, 'Detail', true, fixture.rel) ?? `/${words(fixture.stem).join('-')}`;
  const listRoute = claimedRoute(root, layout, 'List', false, fixture.rel) ?? '/';
  const extra = props.filter((p) => !p.optional && !['title', 'children', 'empty', 'back'].includes(p.name)).map((p) => fillProp(p, Title)).filter(Boolean);
  const client = extra.some((f) => f.includes('=> {}')) ? "'use client';\n" : '';
  const lines = [
    `${head}${client}import Link from 'next/link';`,
    `import ${o.binding} from '${o.spec}';`,
    `import ${data} from '${fixtureSpec}';`,
    '',
  ];
  if (typed) lines.push(`type ${Type} = { ${used.map((f) => `${f.key}: ${f.type}`).join('; ')} };`, '');
  if (money) lines.push(typed ? 'const money = (n: number) => `$${n.toFixed(2)}`;' : 'const money = (n) => `$${n.toFixed(2)}`;', '');
  const rows = typed ? `${data} as ${Type}[]` : data;
  const ex = extra.map((f) => ` ${f}`).join('');
  if (shape === 'list') {
    const key = id.type === 'string' ? `item.${id.key}` : `String(item.${id.key})`;
    const empty = has('empty') ? ` empty={<p>No ${jsxText(Title.toLowerCase())} yet.</p>}` : '';
    lines.push(
      `export function ${o.name}() {`,
      `  const items = ${rows};`,
      '  return (',
      `    <${o.local} title=${attr(Title)}${empty}${ex}>`,
      '      {items.length > 0 && items.map((item) => (',
      `        <article key={${key}} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">`,
      `          <h2 className="text-lg font-semibold"><Link href={\`${detailPrefix}/\${item.${id.key}}\`}>{item.${nameF.key}}</Link></h2>`,
      ...said.map((f) => `          <p>${show(f, 'item')}</p>`),
      '        </article>',
      '      ))}',
      `    </${o.local}>`,
      '  );',
      '}',
    );
    return `${lines.join('\n')}\n`;
  }
  // detail: the spec's fields first as plain text, then the rest of the record as a description list.
  const others = rest.filter((f) => !said.includes(f));
  const asyncParams = nextMajor(root) >= 15;
  const sig = typed
    ? `${asyncParams ? 'async ' : ''}function ${o.name}({ params }: { params: ${asyncParams ? 'Promise<{ id: string }>' : '{ id: string }'} })`
    : `${asyncParams ? 'async ' : ''}function ${o.name}({ params })`;
  const match = id.type === 'string' ? `entry.${id.key} === id` : `String(entry.${id.key}) === id`;
  const backLink = `<Link href=${attr(listRoute)}>Back to ${jsxText(Title)}</Link>`;
  const backAttr = has('back') ? ' back={back}' : '';
  const backChild = has('back') ? [] : ['      {back}'];
  lines.push(
    `export ${sig} {`,
    `  const { id } = ${asyncParams ? 'await params' : 'params'};`,
    `  const item = ${typed ? `(${rows})` : rows}.find((entry) => ${match});`,
    `  const back = ${backLink};`,
    '  if (!item) {',
    has('back') ? `    return <${o.local} title=${attr(`${One} not found`)} back={back}${ex} />;` : `    return <${o.local} title=${attr(`${One} not found`)}${ex}>{back}</${o.local}>;`,
    '  }',
    '  return (',
    `    <${o.local} title={item.${nameF.key}}${backAttr}${ex}>`,
    ...backChild,
    ...said.map((f) => `      <p>${show(f, 'item')}</p>`),
    ...(others.length ? [
      '      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">',
      ...others.flatMap((f) => [`        <dt>${jsxText(humanize(f.key))}</dt>`, `        <dd>${show(f, 'item')}</dd>`]),
      '      </dl>',
    ] : []),
    `    </${o.local}>`,
    '  );',
    '}',
  );
  return `${lines.join('\n')}\n`;
}
