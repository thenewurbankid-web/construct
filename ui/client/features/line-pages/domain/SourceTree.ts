import type { LinePageNode, LinePageTree, PageNodeProp } from '../types';

// A small JSX reader for the contract's mock pages (no server, no parser package in the browser): it reads the
// elements after the first `return` and their attributes into the PageTree shape GET /api/line/page-tree serves
// (packages/engine/line/pageProp.mjs readPageTree), with ids "n0", "n1", ... in document order. It handles what
// the mock project writes, not every JSX form; the real screen gets its tree from the server's parser.

const TAG = /<\/?([A-Za-z][\w.]*)?((?:\s+(?:\{\.\.\.[^}]*\}|[\w-]+(?:=(?:"[^"]*"|\{[^}]*\}))?))*)\s*(\/?)>/g;
const ATTR = /\{\.\.\.([^}]*)\}|([\w-]+)(?:=("[^"]*"|\{[^}]*\}))?/g;

function propsOf(attrs: string): PageNodeProp[] {
  const out: PageNodeProp[] = [];
  for (const m of attrs.matchAll(ATTR)) {
    const [, spread, name, raw] = m;
    const index = out.length;
    if (spread !== undefined) out.push({ name: null, kind: 'spread', value: spread.trim(), index });
    else if (raw === undefined) out.push({ name, kind: 'boolean', value: true, index });
    else if (raw.startsWith('"')) out.push({ name, kind: 'string', value: raw.slice(1, -1), index });
    else {
      const code = raw.slice(1, -1).trim();
      if (code === 'true' || code === 'false') out.push({ name, kind: 'boolean', value: code === 'true', index });
      else if (/^-?\d+(\.\d+)?$/.test(code)) out.push({ name, kind: 'number', value: Number(code), index });
      else if (/^[A-Za-z_$][\w$.]*$/.test(code)) out.push({ name, kind: 'identifier', value: code, index });
      else out.push({ name, kind: 'expression', value: code, index });
    }
  }
  return out;
}

function lineColumn(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset).split('\n');
  return { line: before.length, column: before[before.length - 1].length + 1 };
}

/** The element tree of a page's source. No roots when the source returns no JSX. */
export function treeFromSource(source: string, file = '', feature = ''): LinePageTree {
  const at = source.search(/\breturn\b/);
  const roots: LinePageNode[] = [];
  const stack: LinePageNode[] = [];
  let next = 0;
  if (at >= 0) {
    TAG.lastIndex = at;
    for (let m = TAG.exec(source); m; m = TAG.exec(source)) {
      const [whole, tag = '', attrs, selfClosing] = m;
      if (whole.startsWith('</')) {
        stack.pop();
        continue;
      }
      const isFragment = tag === '';
      const node: LinePageNode = {
        id: `n${next++}`,
        tag: isFragment ? 'Fragment' : tag,
        isFragment,
        isCustomComponent: /^[A-Z]/.test(tag),
        props: propsOf(attrs),
        settable: !isFragment,
        ...lineColumn(source, m.index),
        children: [],
      };
      (stack.length ? stack[stack.length - 1].children : roots).push(node);
      if (!selfClosing) stack.push(node);
    }
  }
  return { file, feature, contentHash: String(source.length), scopeNames: [], roots };
}
