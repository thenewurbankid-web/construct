#!/usr/bin/env node
// #639 -- build and tag a lane the moment a capability lands. A capability is a commit that changes something an end user sees
// or runs (a user-facing path of a lane, packages/tools/dev/lanes.json) and is not a refactor, test, CI, board or lockfile change.
// For every lane with at least one capability commit since its last build tag: run the lane's light check, then create the
// annotated tag `<lane>/build-YYYY-MM-DD-HHMM` (UTC; `design/pack-...` for design) whose message is JSON: the commit range and the
// capability subjects and issue numbers. Non-capability commits ride along with the next build. No model, no network beyond the
// tag push, deterministic. Deploys are not part of this (docs/VERSIONING.md, "Builds").
//
//   node packages/tools/dev/build-on-ready.mjs --branch work/2026-09-23            # dry run (default): print the plan
//   node packages/tools/dev/build-on-ready.mjs --branch work/2026-09-23 --check    # dry run that also runs each lane's check
//   node packages/tools/dev/build-on-ready.mjs --branch work/2026-09-23 --push     # check, tag and push (what CI runs)
//   ... --since 2026-09-24                                                         # dry run only: lanes with no tag yet are planned as if
//                                                                                  # last built at the last commit before that date
//   ... --ref <rev>                                                                # build this revision instead of HEAD
//   ... --json                                                                     # the plan/result as one JSON document
//
// Exit status: 0 done or nothing to do, 1 usage or git error, 3 at least one lane was held by a failing check (the others
// were still built).
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH = path.join(HERE, 'lanes.json');
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const SCHEMA = 'construct-build/1';

/** @param {string} [file] */
export function loadConfig(file = CONFIG_PATH) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ---------------------------------------------------------------------------------------------------------------- globs

/**
 * Turn a small glob into a RegExp: `**` any depth (`**` + `/` may match nothing), `*` one segment, `?` one character,
 * `{a,b}` alternatives (nestable). Everything else is literal.
 *
 * @param {string} glob Repo-relative glob.
 * @returns {RegExp} Anchored expression.
 *
 * @example
 * globToRegExp('ui/**\/*.test.*').test('ui/server/src/a.test.mjs'); // => true
 */
export function globToRegExp(glob) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') { i += 1; out += '(?:.*/)?'; } else out += '.*';
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '{') { depth += 1; out += '(?:'; }
    else if (c === '}' && depth > 0) { depth -= 1; out += ')'; }
    else if (c === ',' && depth > 0) out += '|';
    else out += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

const globCache = new Map();
/**
 * @param {string} file Repo-relative path.
 * @param {string[]} globs Globs.
 * @returns {string|null} The first glob that matches, else null.
 */
export function matchGlob(file, globs) {
  for (const g of globs || []) {
    let re = globCache.get(g);
    if (!re) { re = globToRegExp(g); globCache.set(g, re); }
    if (re.test(file)) return g;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------------ classification

/**
 * Issue numbers referenced by a commit subject as `[#N]` or `(#N)`.
 *
 * @param {string} subject Commit subject.
 * @returns {number[]} Ascending, unique.
 */
export function issuesOf(subject) {
  const found = new Set();
  for (const m of String(subject).matchAll(/[[(]#(\d+)[\])]/g)) found.add(Number(m[1]));
  return [...found].sort((a, b) => a - b);
}

/** The subject without leading `[#N]` references, for the prefix rules. */
function bareSubject(subject) {
  return String(subject).replace(/^(\s*\[#\d+\]\s*)+/, '').trim();
}

function subjectRule(subject, patterns) {
  const s = bareSubject(subject);
  for (const p of patterns || []) if (new RegExp(p, 'i').test(s)) return p;
  return null;
}

/**
 * Is this commit a capability, and for which lanes? Deterministic: the same subject and files always give the same answer.
 * A `[#N]` reference raises `confidence` to `high` but is never required.
 *
 * @param {{ subject: string, files: string[] }} commit The subject and the repo-relative files it touches.
 * @param {object} config The parsed lanes.json.
 * @param {{ lanes?: string[] }} [opts] Only consider these lanes (default: every lane in the config).
 * @returns {{ capability: boolean, lanes: string[], reason: string, confidence: 'high'|'medium', issues: number[] }} The decision.
 *
 * @example
 * classifyCommit({ subject: '[#7] Client: a button', files: ['ui/client/features/x/View.tsx'] }, config).lanes; // => ['cockpit']
 */
export function classifyCommit(commit, config, opts = {}) {
  const subject = commit.subject || '';
  const files = commit.files || [];
  const issues = issuesOf(subject);
  const wanted = (opts.lanes || Object.keys(config.lanes)).filter((l) => config.lanes[l]);
  if (!files.length) return { capability: false, lanes: [], reason: 'no files changed (merge or empty commit)', confidence: 'high', issues };
  const lanes = [];
  const notes = [];
  for (const lane of wanted) {
    const lc = config.lanes[lane];
    const ignoreGlobs = [...(config.ignore || []), ...(lc.ignore || [])];
    const userFacing = files.filter((f) => matchGlob(f, lc.userFacing) && !matchGlob(f, ignoreGlobs));
    if (!userFacing.length) continue;
    const rule = subjectRule(subject, [...(config.ignoreSubjects || []), ...(lc.ignoreSubjects || [])]);
    if (rule) { notes.push(`${lane}: subject matches ignore rule /${rule}/`); continue; }
    lanes.push(lane);
    notes.push(`${lane}: user-facing ${userFacing[0]}${userFacing.length > 1 ? ` (+${userFacing.length - 1} more)` : ''}`);
  }
  if (lanes.length) {
    return { capability: true, lanes, reason: notes.join('; '), confidence: issues.length ? 'high' : 'medium', issues };
  }
  if (notes.length) return { capability: false, lanes: [], reason: notes.join('; '), confidence: 'high', issues };
  const anyLaneFile = files.some((f) => wanted.some((l) => matchGlob(f, config.lanes[l].userFacing)));
  const reason = anyLaneFile
    ? 'only ignored paths (tests, fixtures, CI, board, changelog or lockfile)'
    : 'no user-facing path of any lane';
  return { capability: false, lanes: [], reason, confidence: 'medium', issues };
}

// -------------------------------------------------------------------------------------------------------------- tags

const pad = (n, w = 2) => String(n).padStart(w, '0');

/**
 * `YYYY-MM-DD-HHMM` in UTC.
 *
 * @param {Date} date The instant.
 * @returns {string} The stamp used in tag names.
 */
export function stamp(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

/**
 * The tag name for a build: `<prefix>YYYY-MM-DD-HHMM`, and `-2`, `-3`, ... when that name (or an earlier suffix) is taken.
 *
 * @param {string} tagPrefix The lane's `tagPrefix` (`construct/build-`, `design/pack-`).
 * @param {Date} date UTC clock.
 * @param {Iterable<string>} existing Tag names that already exist.
 * @returns {string} A name not in `existing`.
 */
export function tagName(tagPrefix, date, existing = []) {
  const taken = new Set(existing);
  const base = `${tagPrefix}${stamp(date)}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export function baselineTagName(tagPrefix) {
  return `${tagPrefix}baseline`;
}

/**
 * Read a lane tag name. Understands `<lane>/build-baseline`, `<lane>/build-YYYY-MM-DD-HHMM[-N]` and the older day-only
 * `<lane>/build-YYYY-MM-DD`, and `design/pack-...` for the design lane.
 *
 * @param {string} name Tag name.
 * @returns {{ lane: string, kind: 'baseline'|'build', date: string|null, time: string|null, n: number, sort: string }|null} null when it is not a lane tag.
 *
 * @example
 * parseTagName('cockpit/build-2026-09-24-1930-2'); // => { lane: 'cockpit', kind: 'build', date: '2026-09-24', time: '1930', n: 2, ... }
 */
export function parseTagName(name) {
  const m = /^(construct|guardrails|cockpit|site|adhoc)\/build-(?:(baseline)|(\d{4}-\d{2}-\d{2})(?:-(\d{4})(?:-(\d+))?)?)$|^(design)\/pack-(?:(baseline)|(\d{4}-\d{2}-\d{2})(?:-(\d{4})(?:-(\d+))?)?)$/.exec(name);
  if (!m) return null;
  const lane = m[1] || m[6];
  if (m[2] || m[7]) return { lane, kind: 'baseline', date: null, time: null, n: 0, sort: '' };
  const date = m[3] || m[8];
  const time = m[4] || m[9] || '0000';
  const n = Number(m[5] || m[10] || 1);
  return { lane, kind: 'build', date, time, n, sort: `${date}-${time}-${pad(n, 4)}` };
}

/**
 * The newest of a lane's tags (a baseline is older than any build).
 *
 * @param {string[]} names Tag names of one lane.
 * @returns {string|null} The newest name.
 */
export function newestTag(names) {
  let best = null;
  let bestKey = null;
  for (const name of names) {
    const p = parseTagName(name);
    if (!p) continue;
    const key = p.kind === 'baseline' ? '' : p.sort;
    if (best === null || key > bestKey) { best = name; bestKey = key; }
  }
  return best;
}

/**
 * The annotated-tag message: JSON, so anything can read it back.
 *
 * @param {{ lane: string, branch: string, from: string|null, to: string, builtAt: Date, capabilities: { sha: string, subject: string, issues: number[] }[], commits: number, checks?: { name: string, ms: number }[], kind?: 'baseline'|'build' }} info
 * @returns {string} JSON text (pretty, one trailing newline).
 */
export function tagMessage(info) {
  const caps = info.capabilities || [];
  const doc = {
    schema: SCHEMA,
    kind: info.kind || 'build',
    lane: info.lane,
    branch: info.branch,
    from: info.from,
    to: info.to,
    range: info.from ? `${info.from.slice(0, 9)}..${info.to.slice(0, 9)}` : info.to.slice(0, 9),
    builtAt: info.builtAt.toISOString(),
    commits: info.commits ?? caps.length,
    capabilities: caps.map((c) => ({ sha: c.sha, subject: c.subject, issues: c.issues })),
    issues: [...new Set(caps.flatMap((c) => c.issues))].sort((a, b) => a - b),
  };
  if (info.checks) doc.checks = info.checks.map((c) => ({ name: c.name, ms: c.ms }));
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * Read a tag message back. Tolerates tags made before this format (no message, a plain sentence): those give null.
 *
 * @param {string|undefined|null} text The tag's message.
 * @returns {object|null} The parsed document when it is ours, else null.
 */
export function parseTagMessage(text) {
  if (!text) return null;
  try {
    const doc = JSON.parse(String(text).trim());
    return doc && typeof doc === 'object' && doc.schema === SCHEMA ? doc : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------------------------------------- planning

/**
 * Which lanes build, from what to what, and which capabilities each contains. Pure.
 *
 * `commits` is the history between the oldest lane tag (exclusive) and the tip, oldest first, each `{ sha, subject, files,
 * parents? }`. `lastTags[lane]` is that lane's last tag as `{ name, sha }`; a lane without one is a baseline case and is not
 * planned here (see `planBaselines`). A lane builds when at least one commit since its last tag is a capability for it; the
 * other commits since then ride along. `to` is the tip (or the last commit when no tip is given).
 *
 * @param {{ commits: { sha: string, subject: string, files: string[], parents?: string[] }[], lastTags: Record<string, { name: string, sha: string }|null>, config: object, lanes?: string[], tip?: string }} input
 * @returns {{ lane: string, from: string, to: string, capabilities: { sha: string, subject: string, issues: number[], confidence: string, reason: string }[], commits: number }[]} One entry per building lane, in config order.
 */
export function planBuilds({ commits, lastTags, config, lanes, tip }) {
  const wanted = lanes || Object.keys(config.lanes);
  const out = [];
  for (const lane of wanted) {
    const last = lastTags[lane];
    if (!last) continue;
    const pending = since(commits, last.sha);
    const capabilities = [];
    for (const c of pending) {
      const v = classifyCommit(c, config, { lanes: [lane] });
      if (v.capability) capabilities.push({ sha: c.sha, subject: c.subject, issues: v.issues, confidence: v.confidence, reason: v.reason });
    }
    if (capabilities.length) out.push({ lane, from: last.sha, to: tip || pending[pending.length - 1].sha, capabilities, commits: pending.length });
  }
  return out;
}

/**
 * The commits of `commits` that are not reachable from `sha`. With `parents` on the commits this follows the real graph (a side
 * branch merged after the tag still counts); without it the list is taken as linear, oldest first.
 */
function since(commits, sha) {
  if (commits.some((c) => Array.isArray(c.parents))) {
    const bySha = new Map(commits.map((c) => [c.sha, c]));
    const seen = new Set();
    const stack = [sha];
    while (stack.length) {
      const s = stack.pop();
      if (seen.has(s)) continue;
      seen.add(s);
      for (const p of bySha.get(s)?.parents || []) stack.push(p);
    }
    return commits.filter((c) => !seen.has(c.sha));
  }
  return commits.slice(commits.findIndex((c) => c.sha === sha) + 1);
}

/**
 * The first-run baseline: a lane with no tag yet gets `<lane>/build-baseline` at the tip. It is a starting line, not a build.
 *
 * @param {{ lastTags: Record<string, object|null>, tip: string, config: object, lanes?: string[] }} input
 * @returns {{ lane: string, tag: string, to: string }[]} Lanes needing a baseline.
 */
export function planBaselines({ lastTags, tip, config, lanes }) {
  return (lanes || Object.keys(config.lanes)).filter((lane) => !lastTags[lane]).map((lane) => ({ lane, tag: baselineTagName(config.lanes[lane].tagPrefix), to: tip }));
}

// ------------------------------------------------------------------------------------------------------------- checks

/**
 * Substitute `{from}` / `{to}` in a check's args.
 *
 * @param {string[]} args Arguments from lanes.json.
 * @param {{ from: string, to: string }} vars Values.
 */
export function fillArgs(args, vars) {
  return args.map((a) => a.replace(/\{(from|to)\}/g, (_, k) => vars[k]));
}

/**
 * The failing tests of a `node --test` run, read from its TAP output: each `not ok` line with the few lines after it (the error).
 * The tail of a long run shows only the summary counts; this is what names the test that broke.
 *
 * @param {string} text The command output.
 * @param {number} [max] Most characters returned.
 * @returns {string} The excerpts joined by a blank line, or an empty string when there is no `not ok`.
 *
 * @example
 * failureExcerpt('ok 1 - a\nnot ok 2 - b\n  error: boom\n'); // => 'not ok 2 - b\n  error: boom'
 */
export function failureExcerpt(text, max = 2500) {
  const lines = String(text || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*not ok \d+ - /.test(lines[i])) out.push(lines.slice(i, i + 7).filter((l) => l.trim() !== '---' && !/^\s*duration_ms|^\s*\.\.\.$/.test(l)).join('\n'));
  }
  const t = out.join('\n\n');
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

/** Last lines of a command's output, bounded. */
export function tailOf(text, lines = 25, chars = 3000) {
  const t = String(text || '').trimEnd().split('\n').slice(-lines).join('\n');
  return t.length > chars ? t.slice(-chars) : t;
}

/**
 * Real execFile (no shell) with a timeout; never rejects.
 *
 * @param {string} cmd Program.
 * @param {string[]} args Arguments.
 * @param {{ cwd: string, timeoutMs: number }} opts Working directory and timeout.
 * @returns {Promise<{ code: number|string, output: string, timedOut: boolean }>}
 */
export function execCommand(cmd, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 1 << 27, encoding: 'utf8' }, (err, stdout, stderr) => {
      const output = `${stdout || ''}${stderr || ''}`;
      if (!err) return resolve({ code: 0, output, timedOut: false });
      resolve({ code: err.code ?? 1, output: output || String(err.message), timedOut: Boolean(err.killed && err.signal) });
    });
  });
}

/**
 * Run a lane's check commands in order and stop at the first failure.
 *
 * @param {object} laneConfig The lane's block in lanes.json.
 * @param {{ from: string, to: string, root: string, exec?: typeof execCommand, now?: () => number }} ctx
 * @returns {Promise<{ ok: boolean, results: { name: string, ok: boolean, ms: number, tail?: string }[] }>} The verdict; a failed step carries the output tail.
 */
export async function runLaneCheck(laneConfig, ctx) {
  const exec = ctx.exec || execCommand;
  const now = ctx.now || Date.now;
  const results = [];
  for (const step of laneConfig.check || []) {
    const t0 = now();
    const r = await exec(step.cmd, fillArgs(step.args || [], ctx), { cwd: path.resolve(ctx.root, step.cwd || '.'), timeoutMs: (step.timeoutSec || 300) * 1000 });
    const ms = now() - t0;
    if (r.code === 0) { results.push({ name: step.name, ok: true, ms }); continue; }
    const why = r.timedOut ? `timed out after ${step.timeoutSec || 300}s\n` : '';
    const failed = failureExcerpt(r.output);
    results.push({ name: step.name, ok: false, ms, tail: `${why}${failed ? `${failed}\n---\n` : ''}${tailOf(r.output)}` });
    return { ok: false, results };
  }
  return { ok: true, results };
}

// ----------------------------------------------------------------------------------------------------------------- git

function gitIn(root) {
  return (args, opts = {}) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trimEnd();
}

/**
 * Commits from `base` (exclusive, or all history when null) to `ref`, parents first, with their parents and the files each
 * touched (a merge commit lists none: its changes are in the commits it merged).
 */
export function readCommits(git, base, ref) {
  const range = base ? `${base}..${ref}` : ref;
  const text = git(['log', '--reverse', '--topo-order', '--no-renames', '--name-only', '--format=@@%H%x1f%P%x1f%s', range]);
  const commits = [];
  for (const block of text.split('@@').slice(1)) {
    const [head, ...rest] = block.split('\n');
    const [sha, parents, ...subject] = head.split('\x1f');
    commits.push({ sha, parents: parents.split(' ').filter(Boolean), subject: subject.join('\x1f'), files: rest.map((f) => f.trim()).filter(Boolean) });
  }
  return commits;
}

/**
 * Read the repository, plan, and (when asked) check, tag and push.
 *
 * @param {{ root: string, branch: string, ref?: string, since?: string, config?: object, push?: boolean, check?: boolean, now?: Date, exec?: typeof execCommand, remote?: string }} o
 * @returns {Promise<object>} The result document (also what `--json` prints): baselines, builds (each `planned`, `built`, `held`,
 *   `skipped` or `failed`), held lanes, `install` (directories that need `npm ci` for the lanes that will be checked).
 */
export async function run(o) {
  const config = o.config || loadConfig();
  const git = gitIn(o.root);
  const now = o.now || new Date();
  const ref = o.ref || 'HEAD';
  const lanes = config.branches[o.branch];
  const result = { branch: o.branch, ref, tip: null, dryRun: !o.push, lanes: lanes || [], baselines: [], builds: [], held: [], install: [], notes: [] };
  if (!lanes) throw new Error(`branch "${o.branch}" is not in lanes.json "branches" (${Object.keys(config.branches).join(', ')})`);
  const tip = git(['rev-parse', ref]);
  result.tip = tip;
  if (o.push) { try { git(['fetch', '--tags', '--quiet', o.remote || 'origin']); } catch { result.notes.push('could not fetch tags; using the local ones'); } }
  const allTags = git(['tag', '--list']).split('\n').filter(Boolean);

  // last tag per lane: the newest one reachable from the ref
  const lastTags = {};
  const already = new Set();
  const listed = (args) => git(args).split('\n').filter(Boolean);
  for (const lane of lanes) {
    const merged = new Set(listed(['tag', '--merged', ref, '--list', `${lane}/*`]));
    const name = newestTag(allTags.filter((t) => parseTagName(t)?.lane === lane && merged.has(t)));
    lastTags[lane] = name ? { name, sha: git(['rev-list', '-n1', name]) } : null;
    // idempotency: a build tag of this lane at the ref or after it means these commits were built already
    if (lastTags[lane] && listed(['tag', '--contains', ref, '--list', `${lane}/*`]).some((t) => parseTagName(t)?.lane === lane && parseTagName(t).kind === 'build')) already.add(lane);
  }
  // A simulation for a dry run: lanes with no tag pretend to have been built at the last commit before this date.
  if (o.since) {
    if (o.push) throw new Error('--since only simulates; it cannot be combined with --push');
    const base = git(['rev-list', '-n1', `--before=${o.since} 00:00 +0000`, ref]);
    for (const lane of lanes) if (!lastTags[lane]) lastTags[lane] = { name: `(assumed: last commit before ${o.since})`, sha: base, assumed: true };
    result.notes.push(`--since ${o.since}: lanes without a build tag are planned as if last built at ${base.slice(0, 9)} (simulation; no tag would be created)`);
  }

  result.baselines = planBaselines({ lastTags, tip, config, lanes });
  const tagged = lanes.filter((l) => lastTags[l]);
  let commits = [];
  if (tagged.length) {
    const base = tagged.length === 1 ? lastTags[tagged[0]].sha : git(['merge-base', '--octopus', ...tagged.map((l) => lastTags[l].sha)]);
    commits = readCommits(git, base, ref);
  }
  const planned = planBuilds({ commits, lastTags, config, lanes: tagged.filter((l) => !already.has(l)), tip });
  for (const lane of already) result.notes.push(`${lane}: already built at or after ${tip.slice(0, 9)}`);

  const taken = new Set(allTags);
  for (const b of planned) {
    const laneConfig = config.lanes[b.lane];
    const name = tagName(laneConfig.tagPrefix, now, taken);
    taken.add(name);
    result.builds.push({ lane: b.lane, tag: name, from: b.from, to: b.to, commits: b.commits, capabilities: b.capabilities.map(({ sha, subject, issues, confidence }) => ({ sha, subject, issues, confidence })), status: 'planned', check: null });
  }
  // what `npm ci` the checks of the building lanes need (a CI step reads this before installing anything)
  result.install = [...new Set(result.builds.flatMap((b) => config.lanes[b.lane].install || []))].sort();

  const tagger = (() => { try { git(['config', 'user.name']); return []; } catch { return ['-c', 'user.name=construct-build', '-c', 'user.email=construct-build@users.noreply.github.com']; } })();
  const create = (name, sha, message) => git([...tagger, 'tag', '-a', name, sha, '-F', '-'], { input: message });
  const push = (name) => git(['push', o.remote || 'origin', `refs/tags/${name}`]);

  if (o.push) {
    for (const bl of result.baselines) {
      try {
        create(bl.tag, bl.to, tagMessage({ kind: 'baseline', lane: bl.lane, branch: o.branch, from: null, to: bl.to, builtAt: now, capabilities: [], commits: 0 }));
        push(bl.tag);
        bl.status = 'created';
      } catch (e) { bl.status = 'failed'; bl.error = tailOf(e.stderr || e.message, 5); }
    }
  }
  if (o.push || o.check) {
    for (const b of result.builds) {
      const verdict = await runLaneCheck(config.lanes[b.lane], { from: b.from, to: b.to, root: o.root, exec: o.exec });
      b.check = verdict;
      if (!verdict.ok) { b.status = 'held'; result.held.push(b.lane); continue; }
      if (!o.push) { b.status = 'checked'; continue; }
      try {
        create(b.tag, b.to, tagMessage({ lane: b.lane, branch: o.branch, from: b.from, to: b.to, builtAt: now, capabilities: b.capabilities, commits: b.commits, checks: verdict.results }));
        push(b.tag);
        b.status = 'built';
      } catch (e) { b.status = 'failed'; b.error = tailOf(e.stderr || e.message, 5); }
    }
  }
  return result;
}

/** One-screen text for the terminal. */
export function formatResult(r) {
  const out = [`branch ${r.branch}  tip ${r.tip.slice(0, 9)}  ${r.dryRun ? 'DRY RUN (nothing tagged)' : 'PUSH'}  lanes: ${r.lanes.join(', ')}`];
  for (const b of r.baselines) out.push(`BASELINE ${b.tag} at ${b.to.slice(0, 9)}${b.status ? `  [${b.status}]` : ''}  (a starting line, not a build)`);
  for (const b of r.builds) {
    out.push(`BUILD ${b.tag}  ${b.from.slice(0, 9)}..${b.to.slice(0, 9)}  ${b.capabilities.length} capabilit${b.capabilities.length === 1 ? 'y' : 'ies'} in ${b.commits} commit${b.commits === 1 ? '' : 's'}  [${b.status}]`);
    for (const c of b.capabilities) out.push(`  + ${c.sha.slice(0, 9)} ${c.subject.slice(0, 110)}`);
    if (b.check && !b.check.ok) for (const s of b.check.results.filter((x) => !x.ok)) out.push(`  HELD: ${s.name} failed after ${Math.round(s.ms / 1000)}s`, ...s.tail.split('\n').map((l) => `    ${l}`));
    if (b.error) out.push(`  ERROR: ${b.error}`);
  }
  for (const n of r.notes) out.push(`note: ${n}`);
  if (!r.baselines.length && !r.builds.length) out.push('nothing to build: no lane has a capability commit since its last build tag');
  if (r.install.length) out.push(`install needed for: ${r.install.join(', ')}`);
  return out.join('\n');
}

// ------------------------------------------------------------------------------------------------------------------ CLI

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (n, d) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : d; };
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: HERE, encoding: 'utf8' }).trim();
  try {
    const branch = arg('--branch', execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());
    const result = await run({ root, branch, ref: arg('--ref', 'HEAD'), push: argv.includes('--push'), check: argv.includes('--check'), since: arg('--since'), remote: arg('--remote', 'origin') });
    console.log(argv.includes('--json') ? JSON.stringify(result) : formatResult(result));
    process.exitCode = result.held.length ? 3 : 0;
  } catch (e) {
    console.error(`build-on-ready: ${e.message}`);
    process.exitCode = 1;
  }
}
