// The generated source of one part: the function (or JSX prop, or event) that belongs to it, cut out of the files a run
// wrote, with the file path and the line range. The names come from the same place the question's context takes them
// (question-context.mjs: blocks = layer + function name), so the two always agree. Read-only: generated files are
// rewritten on every Replay, so nothing here ever writes them.
import fs from "node:fs";
import path from "node:path";
import { questionContext } from "../question-context.mjs";

const LAYER_DIR = { Route: "route", Controller: "controller", Workflow: "workflow", Service: "service", Domain: "domain", Page: "page", Component: "component" };
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const filesIn = (dir) => { try { return fs.readdirSync(dir).filter((f) => !f.endsWith(".test.js")).sort(); } catch { return []; } };

// Lines [start, end] (1-based) of a top-level function or const, ending at the first line that closes at column 0.
function definition(lines, name) {
  const re = new RegExp(`^(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function\\s+${esc(name)}\\b|const\\s+${esc(name)}\\b)`);
  const at = lines.findIndex((l) => re.test(l));
  if (at < 0) return null;
  let start = at;
  while (start > 0 && /^\s*\/\//.test(lines[start - 1])) start--; // its own comment lines belong to it
  // the end: where the brackets opened on the first line are closed again (and the statement ends)
  let depth = 0, end = at;
  for (; end < lines.length; end++) {
    for (const ch of lines[end].replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "")) depth += "({[".includes(ch) ? 1 : ")}]".includes(ch) ? -1 : 0;
    if (depth <= 0 && /[;}]\s*$/.test(lines[end])) break;
  }
  end = Math.min(end, lines.length - 1);
  return { start: start + 1, end: end + 1 };
}
// A JSX prop or an event name: the lines that use it, with a little context.
function usage(lines, needle) {
  const re = new RegExp(`\\b${esc(needle)}\\b`);
  const at = lines.findIndex((l) => re.test(l) && !/^\s*\/\//.test(l) && !/^import /.test(l));
  return at < 0 ? null : { start: Math.max(1, at - 1), end: Math.min(lines.length, at + 3), focus: [at + 1] };
}

// blocks: [{ layer, name }] from questionContext. extra: more names to try first (a Stub's own function).
export function findSlices({ outRoot, feature, blocks, extra = [], focusName = null }) {
  const base = path.join(outRoot, "features", feature);
  const slices = [];
  const seen = new Set();
  const generated = fs.existsSync(base);
  for (const b of blocks) {
    const dir = LAYER_DIR[b.layer];
    if (!dir) continue;
    const names = [...extra.filter((e) => e.layer === b.layer).map((e) => e.name), b.name];
    for (const f of filesIn(path.join(base, dir))) {
      const rel = `${dir}/${f}`;
      const lines = fs.readFileSync(path.join(base, rel), "utf8").split("\n");
      for (const raw of names) {
        const label = raw;
        const prop = /^prop (.+)$/.exec(raw), event = /^event (.+)$/.exec(raw);
        const name = (prop?.[1] ?? event?.[1] ?? raw).replace(/\(\)$/, "");
        const r = prop || event ? usage(lines, name) : definition(lines, name);
        if (!r || seen.has(`${rel}:${r.start}`)) continue;
        seen.add(`${rel}:${r.start}`);
        const focus = focusName ? lines.map((l, i) => (r.start <= i + 1 && i + 1 <= r.end && new RegExp(`^\\s*${esc(focusName)}\\s*[:=(]|\\b${esc(focusName)}\\b\\s*[:=]`).test(l) ? i + 1 : 0)).filter(Boolean) : (r.focus ?? []);
        slices.push({ layer: b.layer, name: label, file: `features/${feature}/${rel}`, start: r.start, end: r.end, focus, code: lines.slice(r.start - 1, Math.min(r.end, r.start + 59)).join("\n"), truncated: r.end - r.start >= 60 });
        break;
      }
    }
  }
  return { generated, slices };
}

// The slices for one part of a state (state.mjs).
export function codeFor(st, id, outRoot, { customFn = null, focusName = null } = {}) {
  const ctx = questionContext({ id }, st.resolved, st.spec);
  const layerOfFn = { Domain: "Domain", Controller: "Controller", Service: "Service" };
  const extra = customFn ? Object.values(layerOfFn).map((layer) => ({ layer, name: customFn })) : [];
  return findSlices({ outRoot, feature: st.spec.feature, blocks: ctx.blocks, extra, focusName });
}
