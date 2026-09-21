// #337 — the approval gate: the ONLY place a bot's output (possibly from a
// local model) is written into the user's working tree.
//
// #291's bot runner keeps everything a bot wrote on its own branch
// (`construct/bot/<processId>`) and returns artifacts with `approved: null`.
// This file turns a person's explicit verdict into either "nothing lands"
// (reject) or "exactly the approved diff lands" (approve) — and it carries
// every safety check itself, so the UI that calls it (#292) has no security
// logic to forget.
//
// Two calls, both synchronous, JSON in / JSON out, never throwing on bad input:
//   review(processId)          READ-ONLY. Per artifact: the exact diff, its
//                              sha256, whether it is applicable, and every
//                              reason it is refused. Nothing is written.
//   decide(processId, {...})   The only mutating call. Named artifacts only —
//                              there is no "all". Approve must quote the
//                              sha256 of the diff the person was shown.
//
// The eight rules (issue #337) and where each is enforced:
//  1. explicit per-artifact approval ..... decide(): named paths, `by`, diffSha256
//  2. only what the plan declared ........ inspectArtifact(): OUTSIDE_TOUCHES
//  3. protected paths never applied ...... inspectArtifact(): PATH_INVALID / FROZEN / SYMLINK
//  4. never clobber the user's work ...... inspectArtifact(): DIRTY / DIVERGED / TARGET_EXISTS
//  5. what was approved is what lands .... reviewDiff() + apply(): same bytes, re-verified after
//  6. validate after applying ............ decide(): validation.newViolations (no auto-revert)
//  7. record the verdict .................. recordVerdict(): who, when, the diff hash
//  8. cleanup is a consequence ............ settle(): terminal + all verdicts + no stray branch change
//
// Where a rule was ambiguous the stricter reading was taken; #337's comments
// list them. Text artifacts only: an artifact's bytes must match the sha256 the
// runner recorded, which a binary file cannot.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { planTouches } from '../plan.mjs';
import { matchFrozen, readFrozenGlobs } from '../frozen.mjs';
import { validateArchitecture } from '../architecture-enforcer.mjs';
import { appendLog, setApproval } from './processModel.mjs';
import { topLevelState } from './processMachine.mjs';
import { botBranch } from './botRunner.mjs';

export const GATE_CODES = Object.freeze({
  PROCESS_NOT_FOUND: 'PROCESS_NOT_FOUND',
  PROCESS_ACTIVE: 'PROCESS_ACTIVE',
  BAD_REQUEST: 'BAD_REQUEST',
  BRANCH_MISSING: 'BRANCH_MISSING',
  NOT_A_REPO: 'NOT_A_REPO',
  // per-artifact refusals
  PATH_INVALID: 'PATH_INVALID',
  OUTSIDE_TOUCHES: 'OUTSIDE_TOUCHES',
  FROZEN: 'FROZEN',
  FROZEN_UNREADABLE: 'FROZEN_UNREADABLE',
  SYMLINK: 'SYMLINK',
  DIRTY: 'DIRTY',
  DIVERGED: 'DIVERGED',
  TARGET_EXISTS: 'TARGET_EXISTS',
  TARGET_MISSING: 'TARGET_MISSING',
  MODE_UNSUPPORTED: 'MODE_UNSUPPORTED',
  NO_BRANCH_CHANGE: 'NO_BRANCH_CHANGE',
  CHANGE_MISMATCH: 'CHANGE_MISMATCH',
  HASH_UNRECORDED: 'HASH_UNRECORDED',
  HASH_MISMATCH: 'HASH_MISMATCH',
  DIFF_UNEXPECTED: 'DIFF_UNEXPECTED',
  APPLY_CHECK_FAILED: 'APPLY_CHECK_FAILED',
  // per-decision outcomes that are not refusals of the artifact itself
  ALREADY_DECIDED: 'ALREADY_DECIDED',
  DIFF_STALE: 'DIFF_STALE',
  UNKNOWN_ARTIFACT: 'UNKNOWN_ARTIFACT',
  APPLIED_MISMATCH: 'APPLIED_MISMATCH',
});

const SAFE_MODES = new Set(['100644', '100755']);
const IDENTITY = ['-c', 'user.name=Construct Gate', '-c', 'user.email=gate@construct.invalid', '-c', 'commit.gpgsign=false'];
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// #413: bounded like every synchronous git call in core (see gitTrees.GIT_TIMEOUT_MS); a hung git must not hang the gate.
const GIT_TIMEOUT_MS = 10 * 60 * 1000;

function git(cwd, args, { input } = {}) {
  const res = spawnSync('git', ['--literal-pathspecs', ...IDENTITY, ...args], { cwd, input, maxBuffer: 256 * 1024 * 1024, timeout: GIT_TIMEOUT_MS, killSignal: 'SIGKILL' });
  const err = /** @type {any} */ (res.error)?.code === 'ETIMEDOUT'
    ? `git ${args[0]} did not finish within ${Math.round(GIT_TIMEOUT_MS / 1000)} seconds and was stopped.`
    : (res.stderr?.toString() || res.error?.message || '').trim();
  return { ok: res.status === 0, out: res.stdout ?? Buffer.alloc(0), err };
}
const text = (r) => r.out.toString('utf8');

/** Lexical checks on an artifact path. Returns a reason, or null when fine. */
export function pathProblem(p) {
  if (typeof p !== 'string' || p.length === 0) return 'the path is empty';
  if (p.includes('\0')) return 'the path contains a NUL byte';
  if (p.includes('\\')) return 'the path contains a backslash';
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return 'the path is absolute';
  for (const seg of p.split('/')) {
    if (seg === '') return 'the path has an empty segment (a leading, trailing or doubled slash)';
    if (seg === '.' || seg === '..') return `the path contains a "${seg}" segment`;
    const bare = seg.replace(/[. ]+$/, '').toLowerCase();
    if (bare === '.git' || /^git~\d+$/.test(bare)) return 'the path points into .git';
  }
  return null;
}

const refuse = (code, message) => ({ code, message });

/** A caller-supplied login. Non-empty, printable, bounded. */
function validBy(by) {
  return typeof by === 'string' && by.trim().length > 0 && by.length <= 200 && !/[\u0000-\u001f\u007f]/.test(by);
}

/**
 * @param {object} options
 * @param {object} options.store    a processStore for the project
 * @param {object} [options.runner] the bot runner (for `release()`); optional in tests
 * @param {() => string} [options.now]
 * @param {(root:string) => {violations:object[]}} [options.validate]
 */
export function createApprovalGate({ store, runner = null, now = () => new Date().toISOString(), validate = validateArchitecture } = {}) {
  if (!store) throw new TypeError('createApprovalGate() needs a process store.');

  /** Everything that is the same for every artifact of one process. */
  function context(record) {
    const projectRoot = path.resolve(record.projectRoot);
    let rootReal;
    try { rootReal = fs.realpathSync(projectRoot); } catch { return { error: refuse(GATE_CODES.NOT_A_REPO, `The project root ${projectRoot} does not exist.`) }; }
    const top = git(rootReal, ['rev-parse', '--show-toplevel']);
    if (!top.ok) return { error: refuse(GATE_CODES.NOT_A_REPO, `${projectRoot} is not inside a git repository (${top.err}).`) };
    const repo = fs.realpathSync(text(top).trim());
    const prefix = path.relative(repo, rootReal).split(path.sep).join('/');
    const branch = botBranch(record.id);
    const ref = `refs/heads/${branch}`;
    const tip = git(repo, ['rev-parse', '--verify', '--quiet', ref]);
    if (!tip.ok) return { repo, rootReal, prefix, projectRoot, branch, noBranch: true };
    const branchTip = text(tip).trim();
    const mb = git(repo, ['merge-base', 'HEAD', branchTip]);
    const base = mb.ok ? text(mb).trim() : null;

    // The frozen globs are read ONCE, here, before anything is applied, so an
    // approved change to architecture.yml cannot lift protection for a later
    // artifact in the same decision. An architecture.yml that exists but cannot
    // be parsed fails CLOSED (readFrozenGlobs alone would read it as "none").
    let frozenGlobs = [];
    let frozenUnreadable = false;
    const yml = path.join(rootReal, 'architecture.yml');
    if (fs.existsSync(yml)) {
      try { yaml.load(fs.readFileSync(yml, 'utf8')); frozenGlobs = readFrozenGlobs(rootReal); } catch { frozenUnreadable = true; }
    }
    return { repo, rootReal, prefix, projectRoot, branch, branchTip, base, frozenGlobs, frozenUnreadable };
  }

  const repoRel = (ctx, p) => (ctx.prefix ? `${ctx.prefix}/${p}` : p);

  const lsTree = (ctx, rev, rel) => {
    const r = git(ctx.repo, ['ls-tree', '-z', rev, '--', rel]);
    if (!r.ok) return null;
    const line = text(r).split('\0').filter(Boolean)[0];
    if (!line) return null;
    const m = /^(\d+) (\w+) ([0-9a-f]+)\t/.exec(line);
    return m ? { mode: m[1], type: m[2], oid: m[3] } : null;
  };
  const blob = (ctx, oid) => { const r = git(ctx.repo, ['cat-file', 'blob', oid]); return r.ok ? r.out : null; };

  /** Walk the target path inside the user's tree with lstat. Any symlink
   * component (not only an escaping one) is refused. */
  function symlinkProblem(ctx, p) {
    let cur = ctx.rootReal;
    const segs = p.split('/');
    for (let i = 0; i < segs.length; i += 1) {
      cur = path.join(cur, segs[i]);
      let st;
      try { st = fs.lstatSync(cur); } catch (e) { if (e.code === 'ENOENT') return null; return `cannot inspect ${segs.slice(0, i + 1).join('/')} (${e.code})`; }
      if (st.isSymbolicLink()) return `${segs.slice(0, i + 1).join('/')} is a symbolic link`;
      if (i < segs.length - 1 && !st.isDirectory()) return `${segs.slice(0, i + 1).join('/')} is not a directory`;
    }
    const real = fs.realpathSync(cur);
    if (real !== ctx.rootReal && !real.startsWith(ctx.rootReal + path.sep)) return 'the path resolves outside the project root';
    return null;
  }

  /** Every reason this artifact cannot land, plus the diff that would. Pure
   * read: nothing here writes. */
  function inspectArtifact(record, artifact, ctx, touchesByStep) {
    const refusals = [];
    const out = { path: artifact.path, change: artifact.change, stepId: artifact.stepId ?? null, refusals, diff: null, diffSha256: null };
    const lexical = pathProblem(artifact.path);
    if (lexical) { refusals.push(refuse(GATE_CODES.PATH_INVALID, `Refused: ${lexical}.`)); return out; }

    // 2 — declared touches: same step, same path, declared change kind.
    const declared = touchesByStep.get(artifact.stepId ?? null);
    const decl = declared?.find((f) => f.path === artifact.path);
    const kindOk = decl && (decl.changes.includes(artifact.change) || (decl.changes.includes('move') && artifact.change !== 'modify'));
    if (!kindOk) {
      refusals.push(refuse(GATE_CODES.OUTSIDE_TOUCHES, decl
        ? `The plan declared "${artifact.path}" for ${decl.changes.join('/')}, not "${artifact.change}". The bot did something the plan did not say it would.`
        : `The plan did not declare "${artifact.path}" for ${artifact.stepId ? `step ${artifact.stepId}` : 'any step'}. The bot wrote outside what the plan said it would touch.`));
    }

    // 3 — protected paths.
    if (ctx.frozenUnreadable) refusals.push(refuse(GATE_CODES.FROZEN_UNREADABLE, 'architecture.yml exists but cannot be read, so the frozen list cannot be trusted; nothing is applied.'));
    for (const root of new Set([ctx.rootReal, ctx.projectRoot])) {
      const hit = ctx.frozenGlobs?.length ? matchFrozen(root, path.join(root, artifact.path), ctx.frozenGlobs) : null;
      if (hit) { refusals.push(refuse(GATE_CODES.FROZEN, `"${artifact.path}" matches the frozen glob "${hit}" — frozen files are never changed, even when approved.`)); break; }
    }
    const link = symlinkProblem(ctx, artifact.path);
    if (link) refusals.push(refuse(GATE_CODES.SYMLINK, `Refused: ${link}.`));

    if (ctx.noBranch) { refusals.push(refuse(GATE_CODES.BRANCH_MISSING, `The bot branch ${ctx.branch} no longer exists, so there is nothing to apply.`)); return out; }
    if (!ctx.base) { refusals.push(refuse(GATE_CODES.BRANCH_MISSING, `No common ancestor between HEAD and ${ctx.branch}.`)); return out; }

    const rel = repoRel(ctx, artifact.path);
    const baseEnt = lsTree(ctx, ctx.base, rel);
    const tipEnt = lsTree(ctx, ctx.branchTip, rel);
    if (!baseEnt && !tipEnt) { refusals.push(refuse(GATE_CODES.NO_BRANCH_CHANGE, `The bot branch holds no change to "${artifact.path}".`)); return out; }
    const actual = !baseEnt ? 'create' : !tipEnt ? 'delete' : 'modify';
    if (actual !== artifact.change) refusals.push(refuse(GATE_CODES.CHANGE_MISMATCH, `The record says "${artifact.change}" but the bot branch shows "${actual}".`));
    if ((baseEnt && (baseEnt.type !== 'blob' || !SAFE_MODES.has(baseEnt.mode))) || (tipEnt && (tipEnt.type !== 'blob' || !SAFE_MODES.has(tipEnt.mode)))) {
      refusals.push(refuse(GATE_CODES.MODE_UNSUPPORTED, `"${artifact.path}" is a symlink, submodule or unusual file mode in the bot's output; only regular files are ever applied.`));
    }

    // Hash binding: the diff must produce exactly the bytes the runner recorded.
    const baseBytes = baseEnt && baseEnt.type === 'blob' ? blob(ctx, baseEnt.oid) : null;
    const tipBytes = tipEnt && tipEnt.type === 'blob' ? blob(ctx, tipEnt.oid) : null;
    if (!artifact.after || !artifact.before) {
      refusals.push(refuse(GATE_CODES.HASH_UNRECORDED, 'The run recorded no before/after hashes for this artifact, so an approval could not be tied to exact bytes.'));
    } else {
      const wantAfter = tipBytes ? sha256(tipBytes) : null;
      const wantBefore = baseBytes ? sha256(baseBytes) : null;
      if ((artifact.after.sha256 ?? null) !== wantAfter) refusals.push(refuse(GATE_CODES.HASH_MISMATCH, 'The bot branch content differs from what the run recorded (or is not plain text); refusing to apply it.'));
      else if ((artifact.before.sha256 ?? null) !== wantBefore) refusals.push(refuse(GATE_CODES.HASH_MISMATCH, 'The base content differs from what the run recorded; refusing to apply it.'));
    }

    // 4 — never clobber the user's work.
    const status = git(ctx.repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', rel]);
    if (status.ok && status.out.length) {
      refusals.push(refuse(GATE_CODES.DIRTY, `You have uncommitted changes to "${artifact.path}". The bot started from your last commit and never saw them, so this is not merged — commit or discard your edits, or reject this one.`));
    } else {
      const abs = path.join(ctx.rootReal, artifact.path);
      let st = null;
      try { st = fs.lstatSync(abs); } catch { /* absent */ }
      if (actual === 'create') {
        if (st) refusals.push(refuse(GATE_CODES.TARGET_EXISTS, `"${artifact.path}" already exists in your tree; the bot meant to create it.`));
      } else if (!st) {
        refusals.push(refuse(GATE_CODES.TARGET_MISSING, `"${artifact.path}" does not exist in your tree any more.`));
      } else if (!st.isFile() || !baseBytes || !fs.readFileSync(abs).equals(baseBytes)) {
        refusals.push(refuse(GATE_CODES.DIVERGED, `"${artifact.path}" has changed in your project since the bot started (its base commit ${ctx.base.slice(0, 8)}); applying would not produce what was approved.`));
      }
    }

    // 5 — the exact diff, as reviewable bytes.
    const range = [ctx.base, ctx.branchTip];
    const flags = ['--binary', '--full-index', '--no-renames', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/'];
    const names = git(ctx.repo, ['diff', '--name-only', '-z', '--no-renames', ...range, '--', rel]);
    const changed = names.ok ? text(names).split('\0').filter(Boolean) : [];
    const diff = git(ctx.repo, ['diff', ...flags, ...range, '--', rel]);
    if (!diff.ok || changed.length !== 1 || changed[0] !== rel) {
      refusals.push(refuse(GATE_CODES.DIFF_UNEXPECTED, 'The diff for this file did not have the expected single-file shape.'));
      return out;
    }
    out.patch = diff.out;
    out.diff = diff.out.toString('utf8');
    out.diffSha256 = sha256(diff.out);
    out.afterSha256 = tipBytes ? sha256(tipBytes) : null;
    out.rel = rel;
    if (!refusals.length) {
      const check = git(ctx.repo, ['apply', '--check', '--whitespace=nowarn'], { input: diff.out });
      if (!check.ok) refusals.push(refuse(GATE_CODES.APPLY_CHECK_FAILED, `The diff does not apply cleanly: ${check.err}`));
    }
    return out;
  }

  function touchMap(record) {
    const map = new Map();
    for (const s of record.plan.steps) {
      const one = planTouches({ steps: [s] });
      map.set(s.id, one.files);
    }
    return map;
  }

  const strip = (v) => { const { patch, rel, afterSha256, ...rest } = v; return rest; };

  /** Files the bot branch changed relative to its base, project-relative or repo-relative. */
  function branchChangedFiles(ctx) {
    if (ctx.noBranch || !ctx.base) return [];
    const r = git(ctx.repo, ['diff', '--name-only', '-z', '--no-renames', ctx.base, ctx.branchTip]);
    return r.ok ? text(r).split('\0').filter(Boolean) : null;
  }

  function loadRecord(processId) {
    let record = null;
    try { record = store.load(processId); } catch (e) { return { error: refuse(GATE_CODES.PROCESS_NOT_FOUND, e.message) }; }
    if (!record) return { error: refuse(GATE_CODES.PROCESS_NOT_FOUND, `No process "${processId}".`) };
    return { record };
  }

  function review(processId) {
    const { record, error } = loadRecord(processId);
    if (error) return { ok: false, error };
    const ctx = context(record);
    if (ctx.error) return { ok: false, error: ctx.error };
    const touches = touchMap(record);
    const artifacts = record.artifacts.map((a) => {
      const base = a.approved === null ? strip(inspectArtifact(record, a, ctx, touches)) : { path: a.path, change: a.change, stepId: a.stepId ?? null, refusals: [], diff: null, diffSha256: null };
      return {
        ...base,
        verdict: a.approved === null ? null : (a.verdict ?? { decision: a.approved ? 'approved' : 'rejected' }),
        applicable: a.approved === null && base.refusals.length === 0,
        llm: stepLlm(record, a.stepId),
      };
    });
    const recorded = new Set(record.artifacts.map((a) => repoRel(ctx, a.path)));
    const unrecorded = (branchChangedFiles(ctx) || []).filter((f) => !recorded.has(f));
    return {
      ok: true,
      processId: record.id,
      state: record.state,
      branch: ctx.branch,
      base: ctx.base ?? null,
      artifacts,
      unrecordedBranchChanges: unrecorded,
      resolved: record.artifacts.every((a) => a.approved !== null),
    };
  }

  const stepLlm = (record, stepId) => record.steps.find((s) => s.id === stepId)?.llm ?? null;

  function violationKeys(result) {
    return (result?.violations || []).map((v) => JSON.stringify([v.rule, v.file, v.message]));
  }
  function runValidate(root) {
    try { return { result: validate(root) }; } catch (e) { return { error: e.message }; }
  }

  function decide(processId, request) {
    if (!request || typeof request !== 'object' || !Array.isArray(request.decisions) || request.decisions.length === 0) {
      return { ok: false, error: refuse(GATE_CODES.BAD_REQUEST, 'decide() needs `decisions`: a non-empty list of { path, verdict, diffSha256 }. There is no "approve all".') };
    }
    if (!validBy(request.by)) return { ok: false, error: refuse(GATE_CODES.BAD_REQUEST, 'decide() needs `by`: the signed-in login of the person deciding.') };
    const by = request.by.trim();
    for (const d of request.decisions) {
      if (!d || typeof d !== 'object' || typeof d.path !== 'string' || !['approve', 'reject'].includes(d.verdict)) {
        return { ok: false, error: refuse(GATE_CODES.BAD_REQUEST, 'Each decision needs a string `path` and a `verdict` of "approve" or "reject".') };
      }
    }
    if (new Set(request.decisions.map((d) => d.path)).size !== request.decisions.length) {
      return { ok: false, error: refuse(GATE_CODES.BAD_REQUEST, 'A path may appear only once per call.') };
    }

    const loaded = loadRecord(processId);
    if (loaded.error) return { ok: false, error: loaded.error };
    let record = loaded.record;
    const top = topLevelState(record.state);
    if (top === 'running' || top === 'queued') {
      return { ok: false, error: refuse(GATE_CODES.PROCESS_ACTIVE, `The process is ${top}; pause or wait for it before deciding, so the gate never races the runner.`) };
    }
    const ctx = context(record);
    if (ctx.error) return { ok: false, error: ctx.error };
    const touches = touchMap(record);

    // Preflight every decision BEFORE writing anything (the frozen list and
    // the tree are read once, up front).
    const plan = request.decisions.map((d) => {
      const artifact = record.artifacts.find((a) => a.path === d.path);
      if (!artifact) return { d, result: { path: d.path, verdict: d.verdict, applied: false, decided: false, refusals: [refuse(GATE_CODES.UNKNOWN_ARTIFACT, `No artifact "${d.path}" in this process.`)] } };
      if (artifact.approved !== null) return { d, artifact, result: { path: d.path, verdict: d.verdict, applied: false, decided: false, refusals: [refuse(GATE_CODES.ALREADY_DECIDED, `"${d.path}" already has a final verdict (${artifact.approved ? 'approved' : 'rejected'}); verdicts are not reversed.`)] } };
      if (d.verdict === 'reject') return { d, artifact, reject: true };
      const inspected = inspectArtifact(record, artifact, ctx, touches);
      const refusals = [...inspected.refusals];
      if (!refusals.length && d.diffSha256 !== inspected.diffSha256) {
        refusals.push(refuse(GATE_CODES.DIFF_STALE, 'The diff you approved is not the diff that would land now (or no diffSha256 was given). Review it again.'));
      }
      return { d, artifact, inspected, refusals };
    });

    const willApply = plan.some((p) => p.inspected && !p.refusals.length);
    const baseline = willApply ? runValidate(ctx.rootReal) : null;

    const results = [];
    let applied = 0;
    for (const p of plan) {
      if (p.result) { results.push(p.result); continue; }
      const { d, artifact } = p;
      const llm = stepLlm(record, artifact.stepId);
      if (p.reject) {
        record = recordVerdict(record, artifact, { decision: 'rejected', by, applied: false, diffSha256: null }, llm, `Rejected ${artifact.path}: discarded, nothing was written to your project.`);
        store.save(record);
        results.push({ path: d.path, verdict: 'reject', applied: false, decided: true, refusals: [] });
        continue;
      }
      if (p.refusals.length) {
        record = appendLog(record, { provenance: 'warn', message: `Refused ${artifact.path}: ${p.refusals[0].message}`, stepId: artifact.stepId ?? null, now });
        store.save(record);
        results.push({ path: d.path, verdict: 'approve', applied: false, decided: false, refusals: p.refusals });
        continue;
      }
      const outcome = applyOne(ctx, p.inspected);
      if (!outcome.ok) {
        record = appendLog(record, { provenance: 'warn', message: `Refused ${artifact.path}: ${outcome.refusal.message}`, stepId: artifact.stepId ?? null, now });
        store.save(record);
        results.push({ path: d.path, verdict: 'approve', applied: false, decided: false, refusals: [outcome.refusal] });
        continue;
      }
      applied += 1;
      record = recordVerdict(record, artifact, { decision: 'approved', by, applied: true, diffSha256: p.inspected.diffSha256 }, llm, `Approved ${artifact.path}${llm ? ` (a ${llm.provider} model wrote it)` : ''}: applied exactly the reviewed diff (${p.inspected.diffSha256.slice(0, 12)}).`);
      store.save(record);
      results.push({ path: d.path, verdict: 'approve', applied: true, decided: true, refusals: [] });
    }

    let validation = null;
    if (applied > 0) {
      const after = runValidate(ctx.rootReal);
      if (after.error || baseline?.error) {
        validation = { ran: false, error: after.error || baseline.error, newViolations: [] };
      } else {
        const before = new Set(violationKeys(baseline.result));
        const fresh = (after.result.violations || []).filter((v) => !before.has(JSON.stringify([v.rule, v.file, v.message])));
        validation = { ran: true, ok: fresh.every((v) => v.severity !== 'error'), newViolations: fresh, autoReverted: false };
        record = appendLog(record, {
          provenance: fresh.length ? 'warn' : 'ok',
          message: fresh.length
            ? `Applying the approved files introduced ${fresh.length} new architecture violation(s). Nothing was reverted — see the details.`
            : 'Applying the approved files introduced no new architecture violations.',
          detail: fresh.length ? fresh.slice(0, 20).map((v) => `${v.rule} ${v.file}: ${v.message}`).join('\n') : null,
          now,
        });
        store.save(record);
      }
    }

    const cleanup = settle(record, ctx);
    return { ok: true, processId, results, applied, validation, cleanup, resolved: record.artifacts.every((a) => a.approved !== null) };
  }

  function recordVerdict(record, artifact, verdict, llm, message) {
    let next = setApproval(record, verdict.decision === 'approved', [artifact.path]);
    next = {
      ...next,
      artifacts: next.artifacts.map((a) => (a.path === artifact.path ? { ...a, verdict: { ...verdict, at: now() } } : a)),
    };
    // A model's output landing in the tree is exactly what the `llm` filter
    // exists to answer; a deterministic step's is `ok`. Step statuses and
    // their recorded `llm` are never touched here.
    return appendLog(next, { provenance: verdict.decision === 'approved' && llm ? 'llm' : 'ok', message: `${message} (by ${verdict.by})`, stepId: artifact.stepId ?? null, now });
  }

  /** Apply exactly the reviewed bytes, then prove it. */
  function applyOne(ctx, inspected) {
    const apply = git(ctx.repo, ['apply', '--whitespace=nowarn'], { input: inspected.patch });
    if (!apply.ok) return { ok: false, refusal: refuse(GATE_CODES.APPLY_CHECK_FAILED, `git apply failed: ${apply.err}`) };
    const abs = path.join(ctx.rootReal, inspected.path);
    let bytes = null;
    try { bytes = fs.readFileSync(abs); } catch { /* deleted */ }
    const got = bytes ? sha256(bytes) : null;
    if (got !== inspected.afterSha256) {
      git(ctx.repo, ['apply', '-R', '--whitespace=nowarn'], { input: inspected.patch });
      return { ok: false, refusal: refuse(GATE_CODES.APPLIED_MISMATCH, 'The bytes on disk after applying did not match the approved content; the change was reversed.') };
    }
    return { ok: true };
  }

  /** Rule 8. Release the worktree and delete the bot branch only when the
   * process is finished, every artifact has a verdict, and the branch holds
   * no change that is not one of those decided artifacts. */
  function settle(record, ctx) {
    const top = topLevelState(record.state);
    if (ctx.noBranch) return { done: false, reason: 'no bot branch' };
    if (top !== 'done' && top !== 'cancelled') return { done: false, reason: `the process is ${top}; the bot branch is kept until it finishes` };
    const pending = record.artifacts.filter((a) => a.approved === null);
    if (pending.length) return { done: false, reason: `${pending.length} artifact(s) still have no verdict`, pending: pending.map((a) => a.path) };
    const changed = branchChangedFiles(ctx);
    if (changed === null) return { done: false, reason: 'could not read the bot branch, so it is kept' };
    const decided = new Set(record.artifacts.map((a) => repoRel(ctx, a.path)));
    const stray = changed.filter((f) => !decided.has(f));
    if (stray.length) return { done: false, reason: 'the bot branch holds changes that are not recorded artifacts, so it is kept', stray };
    if (runner) runner.release(record.id);
    // A worktree the runner no longer knows (a restarted server) also blocks branch deletion.
    const wts = git(ctx.repo, ['worktree', 'list', '--porcelain']);
    if (wts.ok && runner?.worktreeRoot) {
      let dir = null;
      for (const line of text(wts).split('\n')) {
        if (line.startsWith('worktree ')) dir = line.slice(9);
        else if (line === `branch refs/heads/${ctx.branch}` && dir && dir.startsWith(runner.worktreeRoot + path.sep)) {
          git(ctx.repo, ['worktree', 'remove', '--force', dir]);
        }
      }
    }
    const del = git(ctx.repo, ['branch', '-D', ctx.branch]);
    return del.ok ? { done: true, branch: ctx.branch } : { done: false, reason: `could not delete ${ctx.branch}: ${del.err}` };
  }

  /** Idempotent: run the cleanup rule on its own (e.g. a process that finished
   * after its last verdict). Never deletes anything the rule forbids. */
  function cleanup(processId) {
    const { record, error } = loadRecord(processId);
    if (error) return { ok: false, error };
    const ctx = context(record);
    if (ctx.error) return { ok: false, error: ctx.error };
    return { ok: true, cleanup: settle(record, ctx) };
  }

  return { review, decide, cleanup };
}
