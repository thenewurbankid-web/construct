// Candidate context lines from a bench run's logs, and their auto-labels (#881). Pure: no I/O, no clock.
//
// A bench builder acts, Line answers (a refusal sentence, fixes, result fields, status text), the builder acts again.
// Everything Line returned since the builder's last action is split into small lines with stable ids. A line is
// USEFUL when the builder's NEXT action used it (its args / why / said contain one of the line's key tokens: a path,
// an export name, a route, a tool or fix step, a code) and that action was accepted; NOISE when the next action
// ignored it and was refused. Everything else (used but refused, ignored but accepted) is unclear and left unlabelled.
//
// Limitation of the logs this reads: calls.jsonl keeps only the summary fields of a result (ok, code, sentence,
// stepId, state, landed, tool, rules). The model was shown the whole JSON result (fixes, options, file content), so
// the fix steps themselves are not candidates here; the turn's real tool-result size comes from turns.jsonl `in`.

/** Model tool name (qwen-agent) -> the CLI command recorded in calls.jsonl (same map as mission-control/bench-log). */
export const TOOL_TO_CMD = {
  plan_tools: 'tools', plan_status: 'status', plan_add: 'add', plan_run_next: 'run-next', plan_findings: 'findings',
  plan_validate: 'validate', read_file: 'read', list_dir: 'ls', tree: 'tree', write_file: 'write', run_script: 'run',
};

/** Rough token count of a text (4 characters per token, the usual estimate for English and code). */
export const estTokens = (s) => Math.ceil(String(s ?? '').length / 4);

/** A short, stable hash (FNV-1a, base 36) for line ids. */
export function hash(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/**
 * Join calls.jsonl and turns.jsonl into actions: one per model turn (with its calls) when turns exist, else one per
 * call. Each turn's outcomes (except finish) consume the next call records in order, as mission-control's joiner does.
 * @param {any[]} calls @param {any[]} turns
 * @returns {{idx: number, turn: number|null, calls: {cmd: string, args: any, why: string, result: any}[], said: string, inTok: number|null, outTok: number|null}[]}
 */
export function joinActions(calls, turns = []) {
  const recs = calls.filter((c) => c?.kind === 'call');
  const asCall = (c) => ({ cmd: String(c.cmd ?? ''), args: c.args, why: typeof c.args?.why === 'string' ? c.args.why : '', result: c.result ?? {} });
  const ts = turns.filter((t) => t?.kind === 'turn');
  if (!ts.length) return recs.map((c, i) => ({ idx: i, turn: null, calls: [asCall(c)], said: '', inTok: null, outTok: null }));
  const out = [];
  let ci = 0;
  for (const t of ts) {
    const cs = [];
    for (const o of t.calls ?? []) {
      if (o.name === 'finish') continue;
      if (!TOOL_TO_CMD[o.name]) { cs.push({ cmd: String(o.name ?? '?'), args: o.args, why: '', result: { ok: o.ok, code: o.code, sentence: o.sentence } }); continue; }
      if (ci < recs.length) { cs.push(asCall(recs[ci])); ci += 1; }
    }
    out.push({ idx: out.length, turn: t.turn, calls: cs, said: String(t.said ?? ''), inTok: t.in ?? null, outTok: t.out ?? null });
  }
  return out;
}

/** The text of an action, for matching key tokens: commands, tools, args, why and what the model said. */
export function actionText(a) {
  return [...a.calls.map((c) => `${c.cmd} ${typeof c.args === 'string' ? c.args : JSON.stringify(c.args ?? '')} ${c.why}`), a.said].join('\n');
}

/** accepted (some call ok) | refused (every call refused) | idle (no call). */
export function actionOutcome(a) {
  if (!a.calls.length) return 'idle';
  return a.calls.some((c) => c.result?.ok === true) ? 'accepted' : 'refused';
}

const GENERIC = new Set(['Line', 'JSON', 'Auto', 'Read', 'Saved', 'Step', 'Validate', 'Add', 'Creates', 'Rewrites', 'Serves', 'There', 'This', 'The', 'A', 'An']);

/**
 * The key tokens of a line: the specific things a next action would carry if it used the line.
 * @param {string} text @returns {string[]}
 */
export function keyTokens(text) {
  const s = String(text);
  const keys = new Set();
  for (const m of s.matchAll(/(?:^|[\s("'`])(\/[\w:/-]+)/g)) if (m[1].length > 1) keys.add(m[1]);                   // route
  for (const m of s.matchAll(/[\w.<>[\]-]+(?:\/[\w.<>:[\]-]+)+/g)) keys.add(m[0].replace(/[.,;)]+$/, ''));           // path
  for (const m of s.matchAll(/\bline\.[\w.]*\w/g)) keys.add(m[0]);                                                     // tool
  for (const m of s.matchAll(/\bfixes\[\d*\]\.step\b|\bfixOf\b|\bcontentHash\b|\brun-next\b|\bleaveAsIs\b|\boptions\[\]\.step\b/g)) keys.add(m[0]);
  if (/\bread it first\b/.test(s)) keys.add('cmd:read');                                                            // next command
  if (/\brun-next lands it\b/.test(s)) keys.add('cmd:run-next');
  for (const m of s.matchAll(/"([^"]{2,40})"/g)) keys.add(m[1]);                                                       // quoted
  for (const m of s.matchAll(/\b[A-Z][a-z]+(?:[A-Z][a-z0-9]*)+\b/g)) if (!GENERIC.has(m[0])) keys.add(m[0]);          // export name
  for (const m of s.matchAll(/\b(?:feature|item|library)\s+([a-z][\w-]{2,})\b/g)) if (!['with', 'only', 'pages'].includes(m[1])) keys.add(m[1]);
  for (const m of s.matchAll(/\bs\d+\b/g)) keys.add(m[0]);                                                             // step id
  for (const m of s.matchAll(/\b[A-Z][A-Z_]{3,}\b/g)) if (m[0] !== 'JSON') keys.add(m[0]);                             // code
  // A path is also used when only its last segment is (ListPage.tsx -> ListPage) or when the next action names the
  // path without the extension.
  for (const k of [...keys]) {
    if (k.includes('/') && !k.includes('<')) {
      const last = k.split('/').pop().replace(/\.\w+$/, '');
      if (/^[A-Z]/.test(last) && last.length > 2) keys.add(last);
    }
  }
  return [...keys];
}

/** Whether an action's text uses a key token (a <placeholder> in a key matches any word). */
export function usesKey(text, key) {
  if (key.startsWith('cmd:')) return new RegExp(`^${key.slice(4)} `, 'm').test(text);
  if (!key.includes('<')) return text.includes(key);
  const re = new RegExp(key.split(/<[^>]+>/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\w.-]+'));
  return re.test(text);
}

/**
 * Split one sentence into clause lines, and lists of paths or tools into one line per item.
 * @param {string} sentence @returns {{text: string, kind: string}[]}
 */
export function splitSentence(sentence) {
  const out = [];
  const clauses = String(sentence ?? '').split(/(?<=[a-z)\]"`.])[.;]\s+(?=[A-Z(])|;\s+|:\s+(?=[a-z])/).map((c) => c.trim()).filter(Boolean);
  for (let c of clauses) {
    const listRe = /((?:[\w.<>[\]/:-]+(?:\/|\.)[\w.<>[\]/:-]+)(?:,\s*(?:and\s+)?[\w.<>[\]/:-]+(?:\/|\.)[\w.<>[\]/:-]+){1,})/;
    const m = c.match(listRe);
    if (m) {
      const items = m[1].split(/,\s*(?:and\s+)?/).map((x) => x.replace(/[.,;)]+$/, ''));
      const head = c.slice(0, m.index).trim().replace(/[(:]+$/, '').trim();
      for (const it of items) out.push({ text: `${head ? `${head} ` : ''}${it}`, kind: 'list-item' });
      c = `${c.slice(0, m.index)}…${c.slice(m.index + m[1].length)}`.trim();
    }
    if (c.replace(/[….,;()\s]/g, '')) out.push({ text: c.replace(/[.]+$/, ''), kind: 'clause' });
  }
  return out;
}

/** The kind of a clause line, from what it says (fix, path/export in a refusal, status, other). */
function clauseKind(text, refused) {
  if (/\bfix(es|Of)?\b|leaveAsIs|instead|read it first|pass (its )?contentHash/i.test(text)) return 'fix';
  if (refused && /[\w<>]+\/[\w<>]+|\b[A-Z][a-z]+[A-Z]\w*\b|\bline\.\w+/.test(text)) return 'refusal-path';
  if (refused) return 'refusal-other';
  if (/^The plan has|joined the plan|^Saved|^Read |entries|^Validate/.test(text)) return 'status';
  return 'result-other';
}

/**
 * The candidate context lines Line returned for one action (what the model saw before its next action).
 * @param {{calls: any[]}} action @param {string} prefix id prefix (run:action)
 * @returns {{id: string, text: string, kind: string, src: string, keys: string[], tokens: number}[]}
 */
export function candidateLines(action, prefix) {
  const lines = [];
  action.calls.forEach((c, ci) => {
    const r = c.result ?? {};
    const refused = r.ok === false;
    for (const l of splitSentence(r.sentence ?? '')) {
      const kind = l.kind === 'list-item' ? (/\bline\.\w/.test(l.text) && !/fixes/.test(l.text) ? 'list-item' : (refused ? 'refusal-path' : 'list-item')) : clauseKind(l.text, refused);
      lines.push({ text: l.text, kind, src: `${c.cmd}.sentence` });
    }
    for (const f of ['code', 'stepId', 'state', 'tool', 'landed']) {
      if (r[f] !== null && r[f] !== undefined && r[f] !== '') lines.push({ text: `${f}: ${r[f]}`, kind: 'field', src: `${c.cmd}.${f}` });
    }
    for (const rule of r.rules ?? []) lines.push({ text: `rule: ${typeof rule === 'string' ? rule : JSON.stringify(rule)}`, kind: 'field', src: `${c.cmd}.rules` });
    for (const fx of r.fixes ?? []) lines.push({ text: `fix: ${typeof fx === 'string' ? fx : JSON.stringify(fx.step ?? fx)}`, kind: 'fix', src: `${c.cmd}.fixes` });
    lines.forEach((l) => { l.ci ??= ci; });
  });
  const seen = new Map();
  return lines.map((l) => {
    const base = `${prefix}:${hash(`${l.src}|${l.text}`)}`;
    const n = seen.get(base) ?? 0; seen.set(base, n + 1);
    return { id: n ? `${base}.${n}` : base, text: l.text, kind: l.kind, src: l.src, keys: keyTokens(l.text), tokens: estTokens(l.text) };
  });
}

/**
 * Label one line against the next action: useful | noise | unclear.
 * @param {{keys: string[]}} line @param {string} nextText @param {string} nextOutcome
 */
export function labelLine(line, nextText, nextOutcome) {
  const used = line.keys.some((k) => usesKey(nextText, k));
  if (used && nextOutcome === 'accepted') return 'useful';
  if (!used && nextOutcome === 'refused') return 'noise';
  return 'unclear';
}

/** A one-line summary of an action (what the model attempted), for the scorer and for jev's state. */
export function attemptText(a) {
  return a.calls.map((c) => {
    const tool = c.cmd === 'add' ? (c.args?.tool ?? c.result?.tool ?? '') : '';
    const args = c.cmd === 'add' ? c.args?.args : c.args;
    const s = typeof args === 'string' ? args : JSON.stringify(args ?? '');
    return `${c.cmd}${tool ? ` ${tool}` : ''} ${s.slice(0, 160)}`.trim();
  }).join(' | ');
}

/**
 * Every candidate line of a run with its label. `shownTokens` is the real size of what the model was shown since its
 * last action (turns.jsonl: next turn's prompt minus this turn's prompt and output), null for runs without turns.
 * @param {string} run @param {any[]} calls @param {any[]} turns
 */
export function buildRun(run, calls, turns = []) {
  const actions = joinActions(calls, turns);
  const rows = [];
  let repeat = 0;
  for (let i = 0; i + 1 < actions.length; i += 1) {
    const a = actions[i]; const next = actions[i + 1];
    if (!a.calls.length) continue;
    const prev = actions[i - 1];
    const code = a.calls.map((c) => c.result?.code).filter(Boolean).join(',');
    const prevCode = prev ? prev.calls.map((c) => c.result?.code).filter(Boolean).join(',') : '';
    repeat = code && code === prevCode ? repeat + 1 : 0;
    const nextText = actionText(next); const nextOut = actionOutcome(next);
    const shown = a.inTok !== null && next.inTok !== null ? Math.max(0, next.inTok - a.inTok - (a.outTok ?? 0)) : null;
    for (const l of candidateLines(a, `${run}:${a.idx}`)) {
      rows.push({
        id: l.id, run, action: a.idx, turn: a.turn, text: l.text, kind: l.kind, src: l.src, keys: l.keys, tokens: l.tokens,
        attempt: attemptText(a), said: a.said.slice(0, 300), outcome: actionOutcome(a), code: code || null, refusalRepeat: repeat,
        shownTokens: shown, next: { outcome: nextOut, attempt: attemptText(next).slice(0, 200) },
        label: labelLine(l, nextText, nextOut),
      });
    }
  }
  return rows;
}
