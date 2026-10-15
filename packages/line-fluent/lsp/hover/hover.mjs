// T4.2: LSP hover on a JS call or function shows its English view and catalog atom. Deterministic, no model.
// buildHoverIndex() maps each member a catalog atom's js snippets call (`Math.max`, `.includes`, `new Set`) and each
// atom id to atoms; hoverAt() finds the call under the cursor and returns an LSP Hover with markdown.
// English view: the catalog `fluent` sentence. T2.1a's `fluentFor` (packages/line-codemod/fluent-form.js) was not on
// this base; when it lands it can be passed as `fluentFor` and is used before the catalog sentence.
// Contract: docs/line/FLUENT-PLAN-2026-10-15.md, T4.2.
import { readFileSync } from 'node:fs';
import { membersOf } from '../definition/definition.mjs';

const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const defaultCatalog = () => readJson('../../../line-smith/src/atoms/catalog.json');

const memberId = (m) => m.key ?? `.${m.method}`;
const IDENT_ARGS = /^(?:new\s+)?[\w$.?]*\(\s*(?:(?:\.\.\.)?[A-Za-z_$][\w$]*\s*(?:,\s*(?:\.\.\.)?[A-Za-z_$][\w$]*\s*)*)?\)$/;

/**
 * How directly a snippet shows a member: 0 = the snippet is just that one call with plain identifier args
 * (`list.at(index)`), 1 = it is the snippet's only call (`list.at(0)`), 2 = one call among several.
 */
const directness = (js, members) => (members.length > 1 ? 2 : IDENT_ARGS.test(js.trim()) ? 0 : 1);

/**
 * @returns {{ byMember: Map<string, string[]>, byAtom: Map<string, {atom, fluent, reads, module}> }}
 *   byMember values are atom ids, best first: most direct snippet, then atoms with a fluent sentence, then catalog order.
 */
export function buildHoverIndex({ catalog = defaultCatalog() } = {}) {
  const byAtom = new Map();
  const ranked = new Map();
  catalog.atoms.forEach((a, order) => {
    byAtom.set(a.atom, { atom: a.atom, fluent: a.fluent ?? null, reads: a.reads ?? null, module: a.module });
    for (const js of [a.js].flat().filter(Boolean)) {
      const members = membersOf(js);
      for (const m of members) {
        const list = ranked.get(memberId(m)) ?? [];
        const rank = [directness(js, members), a.fluent ? 0 : 1, order];
        const prev = list.find((r) => r.atom === a.atom);
        if (!prev) list.push({ atom: a.atom, rank });
        else if (cmp(rank, prev.rank) < 0) prev.rank = rank;
        ranked.set(memberId(m), list);
      }
    }
  });
  const byMember = new Map([...ranked].map(([k, list]) => [k, list.sort((x, y) => cmp(x.rank, y.rank)).map((r) => r.atom)]));
  return { byMember, byAtom };
}

function cmp(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

const CALL = /(new\s+)?(\.?)([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(/dg;
const FUNCTION_DECL = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/dg;

/**
 * The call or function name under `offset` in JS `text`: `{member, name, start, end}` where `member` is a
 * `membersOf`-shaped `{key}` / `{method}`, `name` the bare identifier, and `start`/`end` the hovered span.
 */
export function callAt(text, offset) {
  for (const m of text.matchAll(FUNCTION_DECL)) {
    const [start, end] = m.indices[1];
    if (offset >= start && offset < end) return { member: null, name: m[1], start, end };
  }
  for (const m of text.matchAll(CALL)) {
    const chain = m[3].replace(/\s+/g, '');
    const name = chain.split('.').at(-1);
    const [member] = membersOf(`${m[1] ? 'new ' : ''}${m[2]}${chain}(`);
    // A method call covers only its name (`xs.includes`: not `xs`); a static or `new` call covers the whole chain.
    const end = m.indices[3][1];
    const start = member?.method ? end - name.length : m[1] ? m.indices[1][0] : m.indices[3][0];
    if (offset >= start && offset < end) return { member: member ?? null, name, start, end };
  }
  return null;
}

/**
 * The atom a hovered call maps to: an atom id called or declared by name (`hasItem(xs, x)`), else the best
 * catalog atom whose js snippets call the same member. `alternatives` are the other atoms sharing the member.
 */
export function atomForCall(index, call) {
  if (!call) return null;
  if (!call.member) return index.byAtom.has(call.name) ? { atom: call.name, alternatives: [] } : null;
  const ids = index.byMember.get(memberId(call.member));
  if (!ids?.length) return null;
  return { atom: ids[0], alternatives: ids.slice(1) };
}

/** Markdown for one hovered atom: the fluent sentence (or a note that there is none), the atom id, its reading. */
export function hoverMarkdown({ atom, fluent, reads, module, alternatives = [] }) {
  const lines = [];
  lines.push(fluent ? ['```line', fluent, '```'].join('\n') : '_No fluent sentence for this atom yet._');
  lines.push(`**atom** \`${atom}\`${module ? ` · ${module}` : ''}`);
  if (reads) lines.push(`Reads: ${reads}`);
  if (alternatives.length) lines.push(`Also matches: ${alternatives.map((a) => `\`${a}\``).join(', ')}`);
  return lines.join('\n\n');
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}
const positionAt = (starts, offset) => {
  let line = 0;
  while (line + 1 < starts.length && starts[line + 1] <= offset) line++;
  return { line, character: offset - starts[line] };
};

/**
 * LSP textDocument/hover over JS text. `position` is an LSP `{line, character}` or a plain offset.
 * `fluentFor(atom)` (optional, T2.1a) supplies the English view; the catalog sentence is the fallback.
 * @returns {{contents: {kind: 'markdown', value: string}, range, atom: string, fluent: string|null} | null}
 */
export function hoverAt(index, text, position, { fluentFor = null } = {}) {
  const starts = lineStarts(text);
  const offset = typeof position === 'number' ? position : Math.min(starts[position.line] ?? text.length, text.length) + position.character;
  const call = callAt(text, offset);
  const hit = atomForCall(index, call);
  if (!hit) return null;
  const entry = index.byAtom.get(hit.atom);
  const fluent = (fluentFor && fluentFor(hit.atom)) || entry.fluent;
  return {
    contents: { kind: 'markdown', value: hoverMarkdown({ ...entry, fluent, alternatives: hit.alternatives }) },
    range: { start: positionAt(starts, call.start), end: positionAt(starts, call.end) },
    atom: hit.atom,
    fluent,
  };
}
