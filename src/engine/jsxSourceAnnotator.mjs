// Deterministic JSX source annotator (Cockpit live preview, click-to-source).
//
// `annotateJsxSource(source, { file })` returns the same source with a
// `data-cx-src="<file>:<line>:<col>"` attribute added to every HOST element
// (lowercase tag: div, button, ...). line/col are the 1-based start of the
// element's `<`, i.e. exactly the `line`/`column` `parseJsxTree` reports for
// that node, so a click on the rendered DOM node maps back to a node of the
// Pages Editor tree without any guessing. Custom components and fragments are
// left alone (unknown props would be forwarded/rejected; the host elements
// they render are annotated in their own files). Pure: no I/O, no LLM.
//
// Intended only for a dev-only, in-memory copy handed to a dev server's
// transform step (see ./previewVitePlugin.mjs) -- never written back to disk.
import { parseJsxTree, jsxNameToString } from '../ast/index.mjs';

export const CX_SRC_ATTR = 'data-cx-src';

function walkRecords(records, visit) {
  for (const r of records) {
    visit(r);
    walkRecords(r.children, visit);
  }
}

/** @returns {{ code: string, count: number }} `count` = attributes added. */
export function annotateJsxSource(source, { file }) {
  if (typeof file !== 'string' || !file) throw new Error('annotateJsxSource: `file` is required');
  const { roots } = parseJsxTree(source);
  const inserts = [];
  walkRecords(roots, (r) => {
    if (r.isFragment || r.isCustomComponent) return;
    const opening = r.openingElementNode;
    if (opening.attributes.some((a) => a.type === 'JSXAttribute' && jsxNameToString(a.name) === CX_SRC_ATTR)) return;
    inserts.push({ at: opening.name.range[1], text: ` ${CX_SRC_ATTR}="${file}:${r.line}:${r.column}"` });
  });
  inserts.sort((a, b) => b.at - a.at); // back to front keeps earlier offsets valid
  let code = source;
  for (const { at, text } of inserts) code = code.slice(0, at) + text + code.slice(at);
  return { code, count: inserts.length };
}

/** Parse a `data-cx-src` value. The file may itself contain ':' so split from the right. */
export function parseCxSrc(value) {
  const m = /^(.*):(\d+):(\d+)$/.exec(String(value ?? ''));
  return m ? { file: m[1], line: Number(m[2]), column: Number(m[3]) } : null;
}
