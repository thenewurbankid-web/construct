// Write accepted suggestions into the page source as data-dyn / data-list / data-action attributes.
// Every change is an exact-offset splice of the original text (Construct's `spliceNode`), so formatting,
// comments and everything outside the touched tags are byte-identical. New attributes follow the tag's own
// layout: on their own line with the same indent in a multi-line tag, after the last attribute otherwise.
// (Construct's `setAttributeText` inserts right before `>`, which misindents multi-line tags; see docs/CONSTRUCT-REUSE.md.)
import { spliceNode, renderAttrValue } from "./construct-ast.mjs";
import { parsePage } from "./parse.mjs";
import { planMarkers } from "./suggest-markers.mjs";

export function attrInsertion(source, el, attrs) { // exported for src/pagemap/apply.mjs; behaviour unchanged
  const text = attrs.map(([n, v]) => `${n}${renderAttrValue("string", v)}`);
  const last = el.attrs[el.attrs.length - 1];
  if (!last) return { start: el.start + 1 + el.tag.length, end: el.start + 1 + el.tag.length, text: ` ${text.join(" ")}` };
  const lineStart = source.lastIndexOf("\n", last.start) + 1;
  const multiline = source.slice(el.start, last.start).includes("\n");
  const indent = source.slice(lineStart, last.start).match(/^\s*/)[0];
  const sep = multiline ? `\n${indent}` : " ";
  return { start: last.end, end: last.end, text: text.map((t) => sep + t).join("") };
}

/**
 * Add the markers for the accepted suggestion ids to a page. Ids that are not in
 * `suggestMarkers(source)` are ignored; an element that already has the attribute is left alone,
 * so applying twice changes nothing. Deterministic: same input, same output. Formatting is preserved
 * by construction (text splices), so no prettier pass is needed; the result is re-parsed to be sure it is valid.
 *
 * @param {string} source JSX or TSX page source.
 * @param {Iterable<string>} acceptedIds Suggestion ids (from `suggestMarkers`) the user said yes to.
 * @returns {string} The source with the attributes added (dyn on a part of a sentence is wrapped in a `<span>`).
 * @throws {Error} When the source, or (never expected) the result, is not valid JSX/TSX.
 *
 * @example
 * applyMarkers('export default () => <b>$5.6M</b>;', ["dyn-1:29"]); // => '... <b data-dyn="value">$5.6M</b> ...'
 */
export function applyMarkers(source, acceptedIds) {
  const accepted = new Set(acceptedIds);
  const edits = []; // {start, end, text}
  const perEl = new Map(); // element -> [[attr, value]]
  for (const { suggestion, edit } of planMarkers(source)) {
    if (!accepted.has(suggestion.id)) continue;
    if (edit.wrap) {
      const tok = source.slice(edit.wrap.start, edit.wrap.end);
      edits.push({ start: edit.wrap.start, end: edit.wrap.end, text: `<span ${edit.attr}${renderAttrValue("string", edit.value)}>${tok}</span>` });
    } else if (!edit.el.attrs.some((a) => a.name === edit.attr)) {
      perEl.set(edit.el, [...(perEl.get(edit.el) ?? []), [edit.attr, edit.value]]);
    }
  }
  for (const [el, attrs] of perEl) edits.push(attrInsertion(source, el, attrs));
  // Right to left, so earlier offsets stay valid.
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = source;
  for (const e of edits) out = spliceNode(out, e, e.text);
  parsePage(out); // throws if an edit broke the syntax
  return out;
}
