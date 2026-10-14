// briefGuard (#941, harness arms CD / CD-raw): a driver's brief must carry intent, not the implementation, so the
// 1.5b writes the code. Deterministic: code fences and runs of code-like lines outside them are parsed with the
// TypeScript parser. A brief is rejected when it has
//   - a function or arrow body with more than MAX_BODY_STATEMENTS statements (an implementation), or
//   - more than MAX_CODE_LINES consecutive lines of code.
// Allowed: names, signatures (bodiless), types and interfaces (any length), the spec's wording, and a short shape
// example (at most MAX_CODE_LINES lines), ideally from a different domain.
//
// On a multi-function task the note is for one function: naming another target function rejects it.
//
//   checkBrief(brief, { fn, others }) -> { ok: true } | { ok: false, reason }
import { ts, parse } from '../lib/edit.mjs';

export const MAX_BODY_STATEMENTS = 2;
export const MAX_CODE_LINES = 3;

// A line outside a fence that reads as code rather than prose.
const CODE_LINE = /^(export\s|const\s|let\s|var\s|return\b|if\s*\(|else\b|for\s*\(|while\s*\(|switch\s*\(|case\s|function\s|async\s|import\s|try\b|catch\b|<\/?[A-Za-z][\w.]*[\s>/]|[})\]]+[;,)]*$|\w+(\.\w+)*\(.*\);?$|\w+(\.\w+)*\s*(=|\+=|-=)\s*[^=])|[;{]$|=>\s*[{(]?$/;

// Split into segments: fenced blocks, and runs of consecutive code-like lines outside fences.
function segments(brief) {
  const lines = brief.split('\n');
  const segs = [];
  let fence = null; let run = null;
  const flush = () => { if (run) { segs.push({ fenced: false, lines: run }); run = null; } };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flush();
      if (fence) { segs.push({ fenced: true, lines: fence }); fence = null; } else fence = [];
      continue;
    }
    if (fence) { fence.push(line); continue; }
    if (CODE_LINE.test(line.trim())) (run ??= []).push(line); else flush();
  }
  flush();
  if (fence) segs.push({ fenced: true, lines: fence }); // an unclosed fence still counts
  return segs;
}

function bodyName(node, sf) {
  if (node.name) return node.name.getText(sf);
  const p = node.parent;
  if (p && ts.isVariableDeclaration(p)) return p.name.getText(sf);
  if (p && ts.isPropertyAssignment(p)) return p.name.getText(sf);
  return 'an inline function';
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every rejection ends with one short valid note (another domain), as an example rather than another instruction.
export const SAMPLE_NOTE = 'Show the words "Sold out" when inStock is false and "In stock" otherwise; never print true or false. Keep the rest of the function as it is.';
const reject = (reason) => ({ ok: false, reason: `${reason} Example of a valid note: '${SAMPLE_NOTE}'` });

// fn + others (multi-function tasks): the note is for fn alone and must not name another target function.
export function checkBrief(brief, { fn = null, others = [] } = {}) {
  const named = others.filter((o) => o !== fn && new RegExp(`\\b${escapeRe(o)}\\b`).test(String(brief ?? '')));
  if (named.length) return reject(`one function per note: write the note for ${fn} only (it names ${named.join(', ')}).`);
  for (const seg of segments(String(brief ?? ''))) {
    const text = seg.lines.join('\n');
    const sf = parse(text, 'brief.tsx');
    // 1. Implementations: any function or arrow body with too many statements.
    let impl = null;
    const walk = (node) => {
      if (impl) return;
      if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node))
        && node.body && ts.isBlock(node.body) && node.body.statements.length > MAX_BODY_STATEMENTS) {
        impl = `${bodyName(node, sf)} has a ${node.body.statements.length}-statement body`;
        return;
      }
      ts.forEachChild(node, walk);
    };
    walk(sf);
    if (impl) return reject(`the brief contains an implementation (${impl}). Describe intent; never write the implementation; the 1.5b writes the code.`);

    // 2. Consecutive code lines: every non-blank, non-comment line, except those inside type/interface
    //    declarations and bodiless function signatures (allowed at any length).
    const allowed = new Set();
    for (const st of sf.statements) {
      if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st) || (ts.isFunctionDeclaration(st) && !st.body)) {
        const a = sf.getLineAndCharacterOfPosition(st.getStart(sf)).line;
        const b = sf.getLineAndCharacterOfPosition(st.getEnd()).line;
        for (let i = a; i <= b; i++) allowed.add(i);
      }
    }
    let runLen = 0; let max = 0;
    seg.lines.forEach((l, i) => {
      const t = l.trim();
      const code = t && !/^(\/\/|\/\*|\*)/.test(t) && !allowed.has(i);
      runLen = code ? runLen + 1 : (t ? 0 : runLen); // blank lines inside a block do not break the run
      max = Math.max(max, runLen);
    });
    if (max > MAX_CODE_LINES) return reject(`the brief has ${max} consecutive lines of code (at most ${MAX_CODE_LINES}). Describe intent; never write the implementation; the 1.5b writes the code. Names, signatures, types, the spec's strings and a ${MAX_CODE_LINES}-line shape example from another domain are fine.`);
  }
  return { ok: true };
}
