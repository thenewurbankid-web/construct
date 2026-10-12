// Line logic atoms, the check behind LINE-ATOM: hand-written code that does an atom's job, with the typed fix "use
// atom X". Static and deterministic: each atom's signals (atom.json) are regular expressions that must all match inside
// one function; the innermost matching function is reported, once per atom. A file that already imports an atom is
// not told to use it. Sentences are made by Construct's summarize block (@line/summarize, built on Smith), and
// explainAtomFinding reads the flagged function through atomic-codemod's to-english step for the Details.
//
// It also reports the other half of the kind rule: an atom is used by usecases and services (ATOM_USERS), so a
// component or a page that imports one directly is told to call it from a usecase instead.
import { stripTypeScriptTypes } from 'node:module';
import { plainSentence } from '@line/summarize';
import { summarizeCode } from '@line/summarize/links';
import { ATOM_USERS } from './contract.mjs';
import { listAtoms, atomImport, PACKAGE } from './index.mjs';

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/** The rule id the Line profile reports these findings under. */
export const RULE = /** @type {'LINE-ATOM'} */ ('LINE-ATOM');

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** The name a function node goes by: its own id, the variable, property or method it is assigned to, else "<anonymous>". */
function nameOf(node, parent) {
  if (node.id?.name) return node.id.name;
  if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') return parent.id.name;
  if ((parent?.type === 'Property' || parent?.type === 'MethodDefinition' || parent?.type === 'PropertyDefinition') && parent.key?.type === 'Identifier') return parent.key.name;
  if (parent?.type === 'AssignmentExpression' && parent.left?.type === 'Identifier') return parent.left.name;
  return '<anonymous>';
}

/**
 * Every function in an ESTree AST (typescript-estree, with `range` and `loc`), outermost first.
 * @param {any} ast
 * @param {string} source
 * @returns {{name: string, start: number, end: number, line: number, text: string}[]}
 */
export function functionsOf(ast, source) {
  const out = [];
  const visit = (node, parent) => {
    if (!node || typeof node.type !== 'string') return;
    if (FUNCTION_TYPES.has(node.type) && Array.isArray(node.range)) {
      out.push({ name: nameOf(node, parent), start: node.range[0], end: node.range[1], line: node.loc?.start?.line ?? 1, text: source.slice(node.range[0], node.range[1]) });
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent' || key === 'loc' || key === 'range') continue;
      if (Array.isArray(value)) for (const v of value) visit(v, node);
      else if (value && typeof value === 'object') visit(value, node);
    }
  };
  visit(ast, null);
  return out;
}

/**
 * The atom signals a piece of code matches: every `all` pattern, and one `any` pattern when the signal has them.
 * @param {string} text
 * @param {import('./contract.mjs').AtomDescriptor[]} [atoms]
 * @returns {{atom: string, signal: string}[]}
 */
export function atomSignals(text, atoms = listAtoms()) {
  const out = [];
  for (const a of atoms) {
    for (const s of a.signals) {
      const all = s.all.every((p) => new RegExp(p).test(text));
      const any = !s.any || s.any.length === 0 || s.any.some((p) => new RegExp(p).test(text));
      if (all && any) {
        out.push({ atom: a.id, signal: s.id });
        break;
      }
    }
  }
  return out;
}

/**
 * The atoms a module imports from @line/atoms (`@line/atoms/<id>`), with the import's line.
 * @param {any} ast
 * @returns {{id: string, line: number}[]}
 */
export function atomImportsIn(ast) {
  const out = [];
  for (const node of ast?.body ?? []) {
    if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && typeof node.source?.value === 'string') {
      const spec = node.source.value;
      if (spec.startsWith(`${PACKAGE}/`)) out.push({ id: spec.slice(PACKAGE.length + 1), line: node.loc?.start?.line ?? 1 });
    }
  }
  return out;
}

/**
 * The typed fix of a copy: use the atom.
 * @param {import('./contract.mjs').AtomDescriptor} atom
 * @param {string} fn
 * @returns {import('./contract.mjs').AtomFix}
 */
export function useAtomFix(atom, fn) {
  return {
    id: `LINE-ATOM/use-atom:${atom.id}`,
    sentence: plainSentence(`Replace the hand-written logic in ${fn} with the ${atom.title.toLowerCase()} atom: import ${atom.name} from ${atomImport(atom.id)}, which is written once and tested in every state; Line cannot rewrite this code safely yet`, [fn, atom.name]).sentence,
    rank: 1,
    atom: atom.id,
    import: atomImport(atom.id),
    step: null,
  };
}

/**
 * LINE-ATOM findings in one file: hand-written copies of atoms (innermost function, once per atom), and, for a file of
 * a kind that may not use atoms, each atom import. Pure: the caller parses the file.
 * @param {{file: string, source: string, ast: any, kind?: string, atoms?: import('./contract.mjs').AtomDescriptor[]}} input
 *   `kind`: the Line item kind of the file (components, pages, usecases, ...); undefined skips the user rule.
 * @returns {import('./contract.mjs').AtomFinding[]}
 */
export function findAtomCopies({ file, source, ast, kind, atoms = listAtoms() }) {
  if (kind === 'atoms') return [];
  const imported = atomImportsIn(ast);
  const used = new Set(imported.map((i) => i.id));
  const fns = functionsOf(ast, source).map((f) => ({ ...f, hits: atomSignals(f.text, atoms).filter((h) => !used.has(h.atom)) }));
  const out = [];
  for (const a of atoms) {
    const matching = fns.filter((f) => f.hits.some((h) => h.atom === a.id));
    const innermost = matching.filter((f) => !matching.some((g) => g !== f && g.start >= f.start && g.end <= f.end));
    const f = innermost[0];
    if (!f) continue;
    const signal = a.signals.find((s) => s.id === f.hits.find((h) => h.atom === a.id)?.signal);
    out.push({
      rule: RULE, file, line: f.line, fn: f.name, atom: a.id, signal: signal?.id ?? '',
      message: plainSentence(`${f.name} in ${file} does the job of the ${a.title.toLowerCase()} atom: ${lowerFirst(signal?.sentence.replace(/\.$/, '') ?? 'it matches the atom')}; use ${a.name} from ${atomImport(a.id)} instead`, [f.name, a.name, file]).sentence,
      fixes: [useAtomFix(a, f.name)],
    });
  }
  if (kind && !ATOM_USERS.includes(kind)) {
    for (const imp of imported) {
      const a = atoms.find((x) => x.id === imp.id);
      if (!a) continue;
      out.push({
        rule: RULE, file, line: imp.line, fn: '<module>', atom: a.id, signal: 'atom-user',
        message: plainSentence(`${file} imports the ${a.title.toLowerCase()} atom directly, but atoms are used by usecases and services; call it from a usecase and pass the result in`, [file]).sentence,
        fixes: [{ id: `LINE-ATOM/move-to-usecase:${a.id}`, sentence: plainSentence(`Move the call to ${a.name} into a usecase of this feature and give this file its result; Line cannot move this code safely yet`, [a.name]).sentence, rank: 1, atom: a.id, import: atomImport(a.id), step: null }],
      });
    }
  }
  return out.sort((x, y) => x.line - y.line || x.atom.localeCompare(y.atom));
}

/**
 * The flagged function and the atom, both put into words: the function through atomic-codemod's to-english step
 * (types stripped first), the atom by its registered sentence. Never throws; when atomic-codemod is not linked the
 * summarizer says so in one sentence.
 * @param {import('./contract.mjs').AtomFinding} finding
 * @param {string} source The flagged file's source.
 * @param {{env?: NodeJS.ProcessEnv}} [o]
 * @returns {Promise<import('@line/summarize/contract').Summary>}
 */
export async function explainAtomFinding(finding, source, o = {}) {
  const atom = listAtoms().find((a) => a.id === finding.atom);
  const lines = source.split('\n');
  // The function's text from its first line to the matching close (the same innermost function the check reported).
  const at = lines.slice(finding.line - 1).join('\n');
  let code = at;
  try {
    code = stripTypeScriptTypes(at, { mode: 'strip' });
  } catch {
    // Keep the source as written; to-english says when it cannot read it.
  }
  const body = asFunction(closeOf(code));
  const read = await summarizeCode(body, { kind: 'function', env: o.env });
  const head = atom ? plainSentence(`The ${atom.title.toLowerCase()} atom does this already: ${atom.english.charAt(0).toLowerCase()}${atom.english.slice(1)}`).sentence : null;
  return { sentences: head ? [head, ...read.sentences] : read.sentences, details: read.details, via: 'static' };
}

/** A declaration to-english reads: no export keyword, and an arrow function assigned to a name as a named function. */
function asFunction(code) {
  const bare = code.replace(/^\s*export\s+(default\s+)?/, '');
  const arrow = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(async\s+)?\(([^)]*)\)\s*=>\s*\{/.exec(bare);
  if (!arrow) return bare;
  return `${arrow[2] ?? ''}function ${arrow[1]}(${arrow[3]}) {${bare.slice(arrow[0].length)}`;
}

/** The text up to the brace that closes the first block (a function's body), or the first line when there is none. */
function closeOf(code) {
  const open = code.indexOf('{');
  if (open < 0) return code.split('\n')[0];
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return code.slice(0, i + 1);
    }
  }
  return code;
}
