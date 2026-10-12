// G2: the little static knowledge the recorder needs at load time, from a file's source (no AST, no TypeScript):
//   stateNames(source)  -> {Owner: [name|null, ...]}   the useState / useReducer calls of each component or hook, in order
//   esmExportNames(source) -> {names: string[], hasDefault: boolean}   for the node ESM facade
// A setter recorded at runtime is keyed by its owner and its call order; these names turn that into `tier` instead of
// `state0`. Owners are components (Capitalized) and hooks (use*), the only places hooks can be called.
'use strict';

const OWNER = /(?:^|\n)[ \t]*(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\s*\*?\s*([A-Z][\w$]*|use[A-Z0-9][\w$]*)\s*[(<]|(?:const|let|var)\s+([A-Z][\w$]*|use[A-Z0-9][\w$]*)\s*(?::[^=]+)?=)/g;
const STATE_CALL = /\b(?:React\.)?use(?:State|Reducer)\s*(?:<[^>()]*(?:<[^>()]*>[^>()]*)*>)?\s*\(/g;

/** @param {string} source @returns {Record<string, (string|null)[]>} */
function stateNames(source) {
  const owners = [];
  for (const m of source.matchAll(OWNER)) owners.push({ at: m.index ?? 0, name: m[1] ?? m[2] });
  /** @type {Record<string, (string|null)[]>} */
  const out = {};
  for (const m of source.matchAll(STATE_CALL)) {
    const at = m.index ?? 0;
    const owner = owners.filter((o) => o.at < at).pop();
    if (!owner) continue;
    const lineStart = Math.max(source.lastIndexOf('\n', at), source.lastIndexOf(';', at)) + 1;
    const head = source.slice(lineStart, at);
    const named = /\[\s*([\w$]+)/.exec(head) ?? /(?:const|let|var)\s+([\w$]+)\s*=\s*$/.exec(head);
    (out[owner.name] ??= []).push(named ? named[1] : null);
  }
  return out;
}

/** @param {string} source @returns {{names: string[], hasDefault: boolean}} */
function esmExportNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/\bexport\s+(?:async\s+)?(?:function\s*\*?|class)\s+([\w$]+)/g)) names.add(m[1]);
  for (const m of source.matchAll(/\bexport\s+(?:const|let|var)\s+([\w$]+)/g)) names.add(m[1]);
  for (const m of source.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (n && n !== 'default' && /^[\w$]+$/.test(n)) names.add(n);
    }
  }
  const hasDefault = /\bexport\s+default\b/.test(source) || /\bexport\s*\{[^}]*\bas\s+default\b/.test(source);
  return { names: [...names], hasDefault };
}

module.exports = { stateNames, esmExportNames };
