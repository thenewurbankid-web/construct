#!/usr/bin/env node
// Writes PAGEMAP-REVIEW.md: the review pack for the Page map (a real Subframe page's tree with repetition collapsed, the list
// of suggested edits with strength and reasons, the measured numbers). Deterministic and read-only: it analyses the page and
// runs the eval, and writes only PAGEMAP-REVIEW.md. Run it again after any rule change so the pack never goes stale.
//   node scripts/pagemap-review.mjs [PortfolioHealthFigmaRebuild.tsx]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePage, analyse } from "../src/pagemap/service.mjs";
import { effectiveAll, editsFor, editSummary } from "../src/pagemap/apply.mjs";
import { buildViolations, summarizeViolations } from "../src/pagemap/violations.mjs";
import { effectiveOf, coverage, CLASS_LABELS } from "../src/pagemap/classify.mjs";
import { visibleIds } from "../src/pagemap/collapse.mjs";
import { runPagemapEval } from "../eval/pagemap.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] ?? "PortfolioHealthFigmaRebuild.tsx";
const env = { examplesDir: path.join(root, "examples"), pagesDir: path.join(root, "subframe-app", "src", "pages") };
const a = analyse(resolvePage(env, { file }));
const { inv, cx, proposals, source, follow } = a;
const eff = Object.fromEntries(inv.nodes.filter((n) => n.id !== "root").map((n) => [n.id, effectiveOf(n, proposals[n.id], undefined)]));
const cov = coverage(inv, eff);
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const nodeText = (n) => (n.kind === "text" ? n.text : n.details?.label ?? n.details?.placeholder ?? (n.kind === "table" ? `${n.details.rowCount ?? ""} rows` : n.kind === "list" ? "list" : ""));
const isIcon = (n) => n.details?.subtype === "icon";

// ---- the tree: content nodes only, a layout box with one child folded into it, repeated groups shown once ----
const gById = new Map(cx.groups.map((g) => [g.id, g]));
const keep = new Set();
const mark = (id) => { const n = inv.byId.get(id); let any = false; for (const c of n.children ?? []) if (mark(c)) any = true; const self = eff[id].cls !== "structure" && !isIcon(n); if (self || any) { keep.add(id); return true; } return false; };
for (const e of cx.cv.root) mark(e.id ?? gById.get(e.g).template);
const treeLines = [];
const visit = (id, depth, grp) => {
  if (!keep.has(id)) return;
  const n = inv.byId.get(id);
  const kids = n.kind === "text" ? [] : cx.cv[id].filter((e) => keep.has(e.id ?? gById.get(e.g).template));
  if (eff[id].cls === "structure" && kids.length === 1 && !grp) { entry(kids[0], depth); return; }
  const e = eff[id];
  const label = n.kind === "text" ? `"${clip(n.text, 70)}"${n.attr ? ` @${n.attr}` : ""}` : `<${n.tag}>${nodeText(n) ? " " + clip(nodeText(n), 40) : ""}`;
  treeLines.push(`${"  ".repeat(depth)}- ${label}${grp ? ` **x${grp.count ?? "n"}${grp.mapped ? " (.map)" : ""}** ${grp.slots.filter((s) => s.varies).length ? "varies: " + grp.slots.filter((s) => s.varies).slice(0, 3).map((s) => s.examples.slice(0, 3).map((x) => `"${clip(String(x), 28)}"`).join(" / ")).join("; ") : "identical"}` : ""}${e.cls === "structure" ? "" : ` \`${e.cls}${e.strength === "weak" ? "?" : ""}\``}`);
  for (const k of kids) entry(k, depth + 1);
};
const entry = (e, depth) => { if (e.g) { const g = gById.get(e.g); visit(g.template, depth, g); } else visit(e.id, depth, null); };
for (const e of cx.cv.root) entry(e, 0);

// ---- suggested edits ----
const roots = inv.nodes.filter((n) => n.id !== "root" && !follow[n.id] && !proposals[n.id].delegate);
const editText = (n) => editSummary(a, n.id);
const groups = [
  ["Dynamic values, strong", (p) => p.cls === "dynamic" && p.strength === "strong"],
  ["Dynamic values, weak", (p) => p.cls === "dynamic" && p.strength === "weak"],
  ["Lists", (p) => p.cls === "list"],
  ["Actions", (p) => p.cls === "action"],
  ["Inputs", (p) => p.cls === "input"],
  ["Unsure (rules disagree; nothing is written until you pick)", (p) => p.cls === "unsure"],
];
const tables = groups.map(([title, pred]) => {
  const rows = roots.filter((n) => pred(proposals[n.id]) && !isIcon(n));
  if (!rows.length) return `### ${title}\n\nNone.\n`;
  return `### ${title} (${rows.length})\n\n| Line | Node | Text | Class | Why | Edit |\n|---:|---|---|---|---|---|\n` + rows.map((n) => {
    const p = proposals[n.id];
    return `| ${n.line} | ${n.kind === "text" ? "text" : `\`<${n.tag}>\``}${Object.values(follow).filter((t) => t === n.id).length ? ` x${new Set(Object.keys(follow).filter((k) => follow[k] === n.id).map((k) => inv.byId.get(k).line)).size + 1}` : ""} | ${cell(clip(nodeText(n), 46))} | ${p.cls}/${p.strength} | ${cell(clip(p.reasons.join("; ") + (p.risk ? ` (May be wrong: ${p.risk})` : ""), 150))} | ${cell(editText(n))} |`;
  }).join("\n") + "\n";
});

// ---- states, flows, violations ----
const violations = buildViolations(a, {});
const vsum = summarizeViolations(violations);
const byRule = Object.entries(violations.reduce((m, v) => ((m[v.rule] = (m[v.rule] ?? 0) + 1), m), {})).sort();
const stateRows = a.states.length ? a.states.map((st) => `| ${st.line} | ${st.stateKind} | ${st.source}${st.prop ? ` (${st.prop})` : ""} | \`${cell(clip(st.condition, 50))}\` | \`<${inv.byId.get(st.target).tag}>\` | ${st.team} | ${cell(clip(st.requirement, 140))} |`).join("\n") : "| | | | | | | none found |";
const flowRows = a.interactions.map((i) => `| ${i.line} | ${cell(clip(i.label, 30))} | \`${i.verb}\` | ${i.resolution} | ${i.handler} | ${cell(clip(i.detail, 90))} |`).join("\n");
const flowCount = a.interactions.reduce((m, i) => ((m[i.resolution] = (m[i.resolution] ?? 0) + 1), m), {});
const stateTotals = ["PortfolioHealthFigmaRebuild.tsx", "PortfolioHealthFigmaRebuild2.tsx", "RedesignedPortfolioHealth.tsx"].map((f) => `${f}: ${analyse(resolvePage(env, { file: f })).states.length}`).join(", ");

// ---- the numbers ----
const rep = runPagemapEval();
const pct = (x) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
const names = Object.keys(rep.pages);
const P = (k, f) => names.map((n) => f(rep.pages[n][k]));
const metric = names.map((n) => {
  const r = rep.pages[n];
  return `#### ${n}\n\n| Dynamic proposals | Proposed | Right | Precision | Recall of hand-marked values |\n|---|---:|---:|---:|---:|\n` +
    [["Page map, strong only", "pagemap_strong"], ["Page map, strong + weak", "pagemap_strong_plus_weak"], ["Import rules, strong only (before)", "import_strong"], ["Import rules, strong + weak (before)", "import_strong_plus_weak"]].map(([l, k]) => `| ${l} | ${r.dynamic[k].proposed} | ${r.dynamic[k].right} | ${pct(r.dynamic[k].precision)} | ${pct(r.dynamic[k].recall)} |`).join("\n") +
    `\n\nLists: hand-marked 1 list of ${r.lists.truth_rows} rows; the page map proposes ${r.lists.all} list${r.lists.all === 1 ? "" : "s"} (${r.lists.strong} strong), ${r.lists.correct} of them the right one. Actions: hand-marked ${r.actions.truth} labels; strong proposals ${r.actions.pagemap_strong.proposed} (precision ${pct(r.actions.pagemap_strong.precision)}, recall ${pct(r.actions.pagemap_strong.recall)}); with weak ${r.actions.pagemap_strong_plus_weak.proposed} (precision ${pct(r.actions.pagemap_strong_plus_weak.precision)}). Text nodes: ${r.text_nodes.total}, all classified (${r.text_nodes.dynamic} dynamic, ${r.text_nodes.static} static, ${r.text_nodes.unsure} unsure).\n\n` +
    `| Pipeline on the marked page | Parts extracted | Matched to one API source |\n|---|---:|---:|\n` +
    [["Hand-marked page (ceiling)", "hand"], ["Import rules, strong accepted (before)", "import_strong"], ["Page map, strong accepted", "pagemap_strong"], ["Page map, strong + weak values/fields", "pagemap_strong_plus_weak_fields"]].map(([l, k]) => `| ${l} | ${r.pipeline[k].extracted} | ${r.pipeline[k].matched} |`).join("\n") + "\n";
}).join("\n");
const beat = names.every((n) => rep.pages[n].pipeline.pagemap_strong.matched > rep.pages[n].pipeline.import_strong.matched);

const md = `# Page map v1: review pack

Generated by \`node scripts/pagemap-review.mjs\` (read-only, deterministic). Branch \`line-matcher-pagemap\`, worktree \`construct-worktrees/line-matcher-pagemap\`. Nothing here is committed or released; the design sources and the examples are unchanged.

## What was built

A new page, \`/pagemap\`, that lists **every element and text node** of a designed page (JSX or TSX), gives each one a stable id and a **proposed class with a strength, reasons and a false-positive risk**, collapses repeated rows and cards into one template with a count, and lets you **accept, reject, change or add** each proposal on screen. Every decision is a saved, undoable step in a sidecar (\`pagemap.json\` + \`pagemap.history.jsonl\`); the design source is never touched. \`Apply to a marked copy\` writes \`page.marked.jsx|tsx\` next to the source with exact-offset splices (idempotent, byte-deterministic), and replacing the page is a second, explicit step.

- Engine (pure, deterministic): \`src/pagemap/inventory.mjs\` (node tree), \`collapse.mjs\` (repetition), \`classify.mjs\` (proposals, reusing the import block's suggestMarkers rules through \`planMarkers\` plus contract, header, stat-card and row-slot rules), \`apply.mjs\` (marked copy, diffs), \`store.mjs\` (decisions + history), \`service.mjs\`, \`contract-match.mjs\`, \`preview.mjs\` (wireframe with a \`data-pm-id\` per node).
- Routes: \`src/pagemap-routes.mjs\` (one line of wiring in \`src/server.mjs\`): \`GET /pagemap\`, \`GET /api/pagemap\`, \`POST /api/pagemap/decide | undo | redo | apply | use\`; all behind \`src/http-guard.mjs\`.
- UI: \`src/ui/pagemap.{html,mjs,css}\` (plain JS, one delegated handler, both themes, keyboard operable). Design: \`docs/PAGEMAP.md\`.

## The tree of \`${file}\` with repetition collapsed

- **Before:** ${cov.total} nodes (${inv.counts.text} text nodes, ${inv.counts.container} layout boxes, ${inv.counts.interaction} interactions, ${(inv.counts.table ?? 0) + (inv.counts.list ?? 0) + (inv.counts.row ?? 0) + (inv.counts.cell ?? 0)} table/list parts, ${(inv.counts.media ?? 0) + (inv.counts.visual ?? 0)} media/visuals).
- **After:** ${cx.stats.visible} nodes shown; ${cx.stats.groups} repeated groups collapsed to one template each (the biggest: the ${cx.groups.reduce((m, g) => Math.max(m, g.count ?? 0), 0)}-row table); ${cx.stats.components} repeated components marked (${cx.components.map((c) => `\`<${c.tag}>\` x${c.count}`).join(", ") || "none"}).
- **Coverage:** ${cov.sentence}; ${cov.accountedFor}% of nodes accounted for. (Layout-only boxes are listed as structure.)

Below: content nodes only (layout boxes with one child folded into their child, icons hidden), class in backticks (\`?\` = weak).

${treeLines.join("\n")}

## Suggested edits for \`${file}\`

Every row is a proposal you accept, reject or change in the page; nothing is written until you accept. A repeated row is one proposal (x N = its instances follow it). Static copy, visuals and layout need no edit and are not listed (${cov.static} static, ${cov.visual} visuals).

${tables.join("\n")}

## States and conditionals (requirement items for Product and Design)

The inventory now finds what the design shows only sometimes and lists each as a **state record** (kind \`state\`, its own stable id, linked to the element it affects, with the condition text and a proposed requirement item for Product or Design): conditional rendering (\`cond && <X/>\`, ternaries incl. the else branch as \`not (cond)\`, a \`.map()\` with an empty branch), state props (\`disabled\`, \`aria-disabled/-selected/-expanded/-busy/-checked/-pressed/-invalid/-current\`, \`selected\`, \`active\`, \`loading\`, \`checked\`, \`expanded\`, \`variant="selected|active|disabled|..."\`), state class tokens, skeleton/animate-pulse elements and loading/empty/error wording. They are records, not tree nodes, so the tree's 100% coverage and every node id are unchanged. In the page they are under **States & flows**: keep as a requirement, or dismiss (a decision, undoable). States found: ${stateTotals}. The Subframe pages are static snapshots (one selected nav item each), so the finder is pinned by a test on a sample with every source instead (\`src/pagemap/pagemap.test.mjs\`). For \`${file}\`:

| Line | State | From | Condition | Element | Team | Proposed requirement |
|---:|---|---|---|---|---|---|
${stateRows}

## Interactions and where they resolve

Flow rule: every interaction resolves to an **API endpoint**, a **controller function** or a **marked stub**; a stub is any function with an unused input or nothing returned. ${a.interactions.length} interactions on this page: ${Object.entries(flowCount).map(([k, v]) => `${v} ${k}`).join(", ")}. The verb comes from the label; the contract is read through the existing matcher; no model.

| Line | Interaction | Action | Resolves to | Handler | Detail |
|---:|---|---|---|---|---|
${flowRows}

## Tracked violations

Markers are suggested by Trace, confirmed by you and stored as violations (Construct's \`makeViolation\` shape: rule, severity, file, line, message, why, expected, suggestedFix, plus id, nodeId, status, team) in the sidecar's \`violations\` key after every change. \`${file}\`: **${vsum.total}** (${vsum.open} open); by rule: ${byRule.map(([r, n]) => `\`${r}\` ${n}`).join(", ")}. Sample:

${violations.slice(0, 4).map((v) => `- \`${v.rule}\` (${v.severity}) line ${v.line}: ${v.message} Why: ${clip(v.why, 140)} Fix: ${clip(v.suggestedFix ?? "", 140)}`).join("\n")}

## Measured against the hand-marked pages

Ground truth: \`examples/portfolio-figma-1\`, \`portfolio-figma-2\`, \`portfolio-redesigned\` (hand-marked \`page.jsx\`), the same three designs as the Subframe pages; compared by text (\`eval/pagemap.mjs\`, \`node eval/pagemap.mjs\`, results also in \`eval/out/pagemap.{json,md}\`). "Import rules" are the old suggestMarkers rules alone, recomputed here; their extracted/matched numbers (16/4, 15/5, 13/4 against 36/15, 36/15, 25/7) equal the recorded baseline.

${metric}
**Read this honestly.** With strong proposals only, the page map recovers ${P("dynamic", (d) => pct(d.pagemap_strong.recall)).join(", ")} of the hand-marked values (the import rules alone: ${P("dynamic", (d) => pct(d.import_strong.recall)).join(", ")}) at ${P("dynamic", (d) => pct(d.pagemap_strong.precision)).join(", ")} precision (${P("dynamic", (d) => pct(d.import_strong.precision)).join(", ")} before): more coverage for a few points of precision. Accepting the strong proposals gives ${P("pipeline", (d) => d.pagemap_strong.extracted + "/" + d.pagemap_strong.matched).join(", ")} parts extracted/matched against ${P("pipeline", (d) => d.import_strong.extracted + "/" + d.import_strong.matched).join(", ")} before and ${P("pipeline", (d) => d.hand.extracted + "/" + d.hand.matched).join(", ")} hand-marked. ${beat ? "It beats the earlier baseline on every page, but it does not reach the hand-marked pages" : "It does not beat the earlier baseline on every page"}: the remaining gap is mostly numbers inside sentences (weak, each wants a person), narrative text that names no API value, and values the API does not carry (a design-versus-contract gap, which is what Trace is for). Action recall is limited by design differences: the hand pages add an "Open" button per row that the Subframe pages do not have, and the redesigned page's prompts are components without handlers.

## Screenshots (1440x900, both themes)

| | Light | Dark |
|---|---|---|
| A JSX example (orders, markers removed) | ![](docs/pagemap/jsx-orders-light.png) | ![](docs/pagemap/jsx-orders-dark.png) |
| A real Subframe page | ![](docs/pagemap/subframe-light.png) | ![](docs/pagemap/subframe-dark.png) |

The other two real pages, both themes: \`docs/pagemap/subframe2-{light,dark}.png\` and \`docs/pagemap/redesigned-{light,dark}.png\` (all three load with 200; a test covers them). The orphan UI (summary count, damaged-sidecar warning, help box, Drop control): \`docs/pagemap/orphans-{light,dark}.png\`. More: the review list (\`docs/pagemap/subframe-review-light.png\`), the marked-copy dialog with the second step (\`docs/pagemap/apply-dialog-light.png\`), the source tab (\`docs/pagemap/subframe-source-dark.png\`). Regenerate with \`node scripts/pagemap-shots.mjs\` (it also fails on any console error).

## How to review

1. \`cd line-matcher && node src/server.mjs --port 4300 --no-open\` (from this worktree). To keep your examples clean, add \`--examples /path/to/a/copy\` and copy \`subframe-app/src/pages\` next to it; decisions are written into the example's folder.
2. Open **http://localhost:4300/pagemap?file=PortfolioHealthFigmaRebuild.tsx** (a real page: ${cov.total} nodes), then \`?file=PortfolioHealthFigmaRebuild2.tsx\` and \`?file=RedesignedPortfolioHealth.tsx\`.
3. Open **http://localhost:4300/pagemap?example=portfolio-figma-1** (a hand-marked JSX page: existing markers show as *accepted*) and any other \`?example=<name>\`.
4. Try: click a text in the wireframe; read the reasons and the diff; **Accept all strong**, then **Review weak** and decide a few; mark an unsuggested text as dynamic; **Undo**; **Apply to a marked copy** and read the diff. The second step (Use as the page) only exists for examples.
5. Check hardest: the weak proposals' reasons, the "Unsure" nodes (Fix area), and whether collapsing hid anything you expected to see (expand a group with its x N badge).

## Rules you set, and how they are honoured

Also recorded in \`docs/PAGEMAP.md\`: two identical texts in different places are TWO parts (ids contain the position; a test pins it); text that is neither marked nor static is static at least (an unsure node counts as static until decided, nothing is written for it); suggested markers are stored as violations; table content is tracked by row and column index (\`details.row\`/\`col\`, shown in the panel); charts are summarised by mapping (labels inside a graphic, each with the data items of the contract it could stand for; nothing is guessed silently). Construct gap: \`makeViolation\` only accepts a \`module\` from three closed values, so Trace builds the same field set itself and a test validates it against Construct's function with \`module: "readability"\`.

## Known limits

- The middle pane is a wireframe drawn from the same tree (components are boxes, Tailwind is not interpreted beyond flex/grid direction), not the rendered design. A click on the *rendered* Subframe app selecting a node needs its dev preview running with Construct's annotator; the positions already agree (a test pins that), the overlay is not built. See \`docs/PAGEMAP.md\`.
- Matching between the hand-marked and the Subframe page is by text, so a hand page that splits a value differently (\`$280\` + \`M\` versus \`$280M\`) counts as a miss.
- A decision applies only while the node at its id still matches the signature stored with it (kind, tag, path, text, structure); if not it is an orphan, never re-anchored silently, so apply and use cannot mark a different node. A damaged sidecar is dropped entry by entry with visible warnings.
- Node ids are **positional** (file + line:col + tag path): any edit that moves a line, even whitespace, changes ids and orphans the decisions made on them. Orphans are counted in the summary line, listed under States & flows, and can be re-attached (decide again on the node now there) or dropped; nothing is silently re-mapped.
- "Use as the page" never overwrites a backup: the first original stays \`page.before-pagemap.jsx\`, later ones are \`.2\`, \`.3\`; undo = copy a backup over the page.
`;
fs.writeFileSync(path.join(root, "PAGEMAP-REVIEW.md"), md);
console.log(`PAGEMAP-REVIEW.md written (${md.split("\n").length} lines)`);
