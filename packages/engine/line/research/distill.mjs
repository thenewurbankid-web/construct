// #936 -- the coder's own tool results, distilled into ledger entries (one plain sentence + cites each), deterministic
// per tool family, so a turn can be built fresh from rules + the ledger view + the step + the last result, with no
// message history resent:
//   read_file                        a fact: the file in one sentence (contextPicker's staticSummarizer)
//   list_dir / tree                  a fact: what the folder holds
//   a refusal (ok false, a step that did not land, a fill that failed)
//                                    a fact: the error's first sentence, its code/rule beside it (never in the sentence)
//                                    a miss: the attempted call; the same attempt again folds into one miss with a count
//   plan_run_next landed / write_file / a passing fill
//                                    a decision: what landed, citing the files it touched
//   plan_add accepted                a decision: the step that was planned
//   anything else with a sentence    a fact: its first sentence
import path from 'node:path';
import { staticSummarizer } from '../contextPicker.mjs';
import { camelToWords } from '@line/summarize';

/** @typedef {{kind: 'fact'|'decision'|'miss', english: string, cites: string[], rule?: string, key?: string}} Distilled */

const first = (s) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return (t.match(/^.*?[.?!](?=\s|$)/) ?? [t])[0].trim();
};
const stop = (s) => (/[.?!]$/.test(s) ? s : `${s}.`);
/**
 * A tool name as words: "line.setCode" -> "set code"; "plan_run_next" -> "plan run next".
 * @param {string} name
 * @returns {string}
 */
export const toolWords = (name) => camelToWords(String(name ?? 'a tool').replace(/^[a-z]+\./, '')).replace(/_/g, ' ');
/** Canonical JSON, keys sorted: the same call compares equal whatever order its args came in. */
const canon = (v) => JSON.stringify(v ?? {}, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const fileArg = (a) => [a?.path, a?.file, a?.args?.file, a?.args?.page].find((x) => typeof x === 'string' && x) ?? null;

/**
 * Is this result a refusal (not ok, a step that did not land, a fill that failed)?
 * @param {any} result
 * @returns {boolean}
 */
export function isRefusal(result) {
  if (!result || typeof result !== 'object') return false;
  return result.ok === false || (result.landed === false && !!result.code) || result.pass === false;
}

/**
 * One tool result as ledger entries.
 * @param {string} toolName
 * @param {any} result
 * @param {{args?: any, root?: string}} [o]
 * @returns {Distilled[]}
 */
export function distill(toolName, result, o = {}) {
  const args = o.args && typeof o.args === 'object' ? o.args : {};
  const file = fileArg(args);
  const r = result && typeof result === 'object' ? result : {};
  if (isRefusal(r)) {
    const code = String(r.code ?? r.state ?? 'REFUSED');
    const rules = Array.isArray(r.rules) ? r.rules : (r.findings ?? []).filter((f) => f?.severity === 'error').map((f) => f.rule);
    const rule = [...new Set([code, ...rules].filter(Boolean))].join(', ');
    const cites = [...new Set([file, ...(r.findings ?? []).map((f) => (f?.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : null))].filter(Boolean))].slice(0, 4);
    const tool = args.tool ? toolWords(args.tool) : toolWords(toolName);
    const said = first(r.sentence ?? r.error ?? '') || `The ${toolWords(toolName)} call was refused.`;
    return [
      { kind: 'fact', english: stop(said), cites, rule },
      { kind: 'miss', english: `A ${tool} step${file ? ` on ${file}` : ''} was refused`, cites: file ? [file] : [], rule: code, key: `${toolName}:${canon(args)}:${code}` },
    ];
  }
  if (toolName === 'read_file' && file) {
    let s = null;
    if (o.root) { try { s = staticSummarizer.summarize(o.root, file).sentence; } catch { s = null; } }
    const lines = typeof r.text === 'string' ? r.text.split('\n').length : typeof r.content === 'string' ? r.content.split('\n').length : null;
    return [{ kind: 'fact', english: stop(first(s ?? `${path.posix.basename(file)} was read${lines ? `, ${lines} lines` : ''}`)), cites: [file] }];
  }
  if (toolName === 'list_dir' || toolName === 'tree') {
    const list = r.entries ?? r.files ?? [];
    const dir = file ?? '.';
    return [{ kind: 'fact', english: `The folder ${dir === '.' ? 'at the project root' : dir} holds ${list.length} entr${list.length === 1 ? 'y' : 'ies'}${list.length ? `: ${list.slice(0, 6).join(', ')}${list.length > 6 ? ', and more' : ''}` : ''}.`, cites: [dir] }];
  }
  if ((toolName === 'plan_run_next' && r.landed === true) || (toolName === 'write_file' && r.ok !== false) || (toolName === 'fill' && r.pass === true)) {
    const files = [...new Set([...(r.files ?? []).map((f) => (typeof f === 'string' ? f : f?.path ?? f?.file)), file].filter(Boolean))].slice(0, 4);
    const what = r.tool ? `A ${toolWords(r.tool)} step` : toolName === 'fill' ? `The fill of ${args.stubId ? String(args.stubId).split('.').pop() : 'a stub'}` : `A ${toolWords(toolName)} call`;
    return [{ kind: 'decision', english: `${what} landed${files.length ? ` and changed ${files.map((f) => path.posix.basename(f)).join(', ')}` : ''}.`, cites: files }];
  }
  if (toolName === 'plan_add' && r.ok !== false) {
    return [{ kind: 'decision', english: `A ${args.tool ? toolWords(args.tool) : args.fix ? 'fix' : 'plan'} step was planned${file ? ` for ${file}` : ''}.`, cites: file ? [file] : [] }];
  }
  const said = first(r.sentence ?? '');
  return said ? [{ kind: 'fact', english: stop(said), cites: file ? [file] : [] }] : [];
}

/**
 * Distil one result into `ledger` (a createLedger): facts and decisions are added, a miss goes through addMiss so a
 * repeated failure is one entry with a count. Returns the entries written.
 * @param {ReturnType<typeof import('./ledger.mjs').createLedger>} ledger
 * @param {string} toolName @param {any} args @param {any} result
 * @param {{root?: string, turn?: number}} [o]
 * @returns {import('./ledger.mjs').LedgerEntry[]}
 */
export function recordToolResult(ledger, toolName, args, result, o = {}) {
  const out = [];
  for (const d of distill(toolName, result, { args, root: o.root })) {
    if (d.kind === 'miss') out.push(ledger.addMiss({ english: d.english, key: /** @type {string} */ (d.key), cites: d.cites, rule: d.rule, turn: o.turn, source: 'coder' }));
    else out.push(ledger.add({ kind: d.kind, english: d.english, cites: d.cites, ...(d.rule ? { rule: d.rule } : {}), source: 'coder', turn: o.turn }));
  }
  return out;
}
