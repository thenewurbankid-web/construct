// Craft.js layout -> one TSX file (#679). Pure and deterministic: the same node map always gives byte-identical text,
// shaped for `construct create page <Name> --feature <f> --from <file>`. Every Button gets its own handler prop named
// from its label (`Add category` -> `onAddCategory`), never a shared `onClick`.

/** One node of Craft's `query.serialize()` output (parsed), only the fields the export reads. */
export type SerializedNode = {
  type: string | { resolvedName: string };
  props?: Record<string, unknown>;
  nodes?: string[];
  hidden?: boolean;
  isCanvas?: boolean;
  parent?: string | null;
};

export type SerializedNodes = Record<string, SerializedNode>;

const ROOT = 'ROOT';
const INDENT = '  ';

const words = (text: string): string[] => text.split(/[^A-Za-z0-9]+/).filter(Boolean);
const pascal = (text: string): string => words(text).map((w) => w[0].toUpperCase() + w.slice(1)).join('');

/** A component name from free text: `my page` -> `MyPage`; a leading digit or nothing usable falls back to `Page`. */
export function componentName(name: string): string {
  const n = pascal(name);
  return /^[A-Z]/.test(n) ? n : `Page${n}`;
}

/** A handler prop from a button label: `Add category` -> `onAddCategory`; an empty label -> `onButton`. */
export function handlerName(label: string): string {
  return `on${pascal(label) || 'Button'}`;
}

const typeOf = (node: SerializedNode): string => (typeof node.type === 'string' ? node.type : node.type?.resolvedName ?? '');
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
};

/** A JSX attribute value: a plain string literal when JSX can hold it verbatim, an expression otherwise. */
const attr = (v: string): string => (/["\\\n\r{}]/.test(v) ? `{${JSON.stringify(v)}}` : `"${v}"`);
/** JSX text: verbatim when it has nothing JSX would read differently, a string expression otherwise. */
const text = (v: string): string => (v !== '' && /^[^{}<>&\n\r]*$/.test(v) && v.trim() === v ? v : `{${JSON.stringify(v)}}`);

type Ctx = { nodes: SerializedNodes; handlers: string[]; seen: Set<string> };

function claimHandler(ctx: Ctx, label: string): string {
  const base = handlerName(label);
  let name = base;
  for (let i = 2; ctx.seen.has(name); i++) name = `${base}${i}`;
  ctx.seen.add(name);
  ctx.handlers.push(name);
  return name;
}

function renderChildren(ctx: Ctx, node: SerializedNode, depth: number): string[] {
  const out: string[] = [];
  for (const id of node.nodes ?? []) out.push(...renderNode(ctx, id, depth));
  return out;
}

function renderNode(ctx: Ctx, id: string, depth: number): string[] {
  const node = ctx.nodes[id];
  if (!node || node.hidden) return [];
  const pad = INDENT.repeat(depth);
  const p = node.props ?? {};
  switch (typeOf(node)) {
    case 'Container': {
      const direction = p.direction === 'row' ? 'row' : 'column';
      const style = `{{ display: 'flex', flexDirection: '${direction}', gap: ${num(p.gap, 8)}, padding: ${num(p.padding, 16)} }}`;
      const children = renderChildren(ctx, node, depth + 1);
      if (children.length === 0) return [`${pad}<div style=${style} />`];
      return [`${pad}<div style=${style}>`, ...children, `${pad}</div>`];
    }
    case 'Heading': {
      const level = [1, 2, 3].includes(Number(p.level)) ? Number(p.level) : 2;
      return [`${pad}<h${level}>${text(str(p.text, 'Heading'))}</h${level}>`];
    }
    case 'Text':
      return [`${pad}<p>${text(str(p.text, 'Text'))}</p>`];
    case 'Button': {
      const label = str(p.label, 'Button');
      const variant = p.variant === 'secondary' ? 'secondary' : 'primary';
      return [`${pad}<button type="button" data-variant="${variant}" onClick={${claimHandler(ctx, label)}}>${text(label)}</button>`];
    }
    case 'Image':
      return [`${pad}<img src=${attr(str(p.src))} alt=${attr(str(p.alt))} />`];
    default: {
      const children = renderChildren(ctx, node, depth + 1);
      return children.length ? [`${pad}<>`, ...children, `${pad}</>`] : [];
    }
  }
}

/**
 * The layout as one TSX module: `type <Name>Props` (one `() => void` per button) above
 * `export default function <Name>({ ...handlers }: <Name>Props) { return (...); }`. One element per node, children in
 * order, hidden nodes left out; a node type it does not know becomes a fragment of its children.
 */
export function serializeToTsx(nodes: SerializedNodes, { name }: { name: string }): string {
  const fn = componentName(name);
  const ctx: Ctx = { nodes, handlers: [], seen: new Set() };
  let body = renderNode(ctx, ROOT, 2);
  if (body.length === 0) body = [`${INDENT.repeat(2)}<div />`];
  const lines: string[] = [];
  if (ctx.handlers.length > 0) {
    lines.push(`type ${fn}Props = {`, ...ctx.handlers.map((h) => `${INDENT}${h}: () => void;`), '};', '');
    lines.push(`export default function ${fn}({ ${ctx.handlers.join(', ')} }: ${fn}Props) {`);
  } else {
    lines.push(`export default function ${fn}() {`);
  }
  lines.push(`${INDENT}return (`, ...body, `${INDENT});`, '}', '');
  return lines.join('\n');
}
