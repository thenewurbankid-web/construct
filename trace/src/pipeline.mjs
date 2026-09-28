// The whole process, shared by the terminal (cli.mjs) and the web UI (server.mjs).
//   1 extract  2 match  3 ask  4 plan  5 emit
// emit(type, data) reports progress; prompt(q, n, total) answers questions without the terminal.
import fs from "node:fs";
import path from "node:path";
import * as prettier from "prettier";
import { extract } from "./extract.mjs";
import { match } from "./match.mjs";
import { buildQuestions, resolveQuestions } from "./ask.mjs";
import { makePlan } from "./plan.mjs";
import {
  emitService,
  emitDomain,
  emitDomainTest,
  emitWorkflow,
  emitController,
  emitRoute,
  emitMock,
} from "./emit.mjs";
import { rewritePage } from "./rewrite-page.mjs";
import { foundTree, buildTree } from "./tree/model.mjs";
import { renderTreeHtml } from "./tree-report.mjs";
import { snapshotTies, noteFor } from "./infer.mjs";
import { computeHints, openItems } from "./hints.mjs";
import { buildLayers } from "./tree/layers.mjs";
import { createAi } from "./ai/index.mjs";
import { questionContext } from "./question-context.mjs";
import { diffFile } from "./diff.mjs";
import { summaryBlocks } from "./summary-blocks.mjs";
import { buildActions, composeEmail } from "./actions.mjs";
import { readSpec } from "./contract.mjs";
import { mergeViewModel, loadViewModel, saveViewModel, toExtractedShape } from "./viewmodel.mjs";
import { createWriteTransaction } from "./write-transaction.mjs";

const wait = (ms) => (ms ? new Promise((r) => setTimeout(r, ms)) : null);

/**
 * Run the whole pipeline for one example: extract, match, ask, plan, emit. Shared by the terminal (`cli.mjs`)
 * and the web UI (`server.mjs`).
 *
 * @param {object} options
 * @param {string} options.dir The example's directory.
 * @param {string} options.outRoot Where generated code is written (features are written under
 *   `outRoot/features/<feature>`).
 * @param {boolean} [options.useSaved] Read `answers.json` for previously saved answers.
 * @param {boolean} [options.askAll] Ask about every part, even ones with exactly one candidate.
 * @param {boolean} [options.auto] Never prompt; anything unanswered is left open (see `resolveQuestions`).
 * @param {{enabled?: boolean, explain?: boolean, overrides?: object, trusted?: boolean}|null} [options.ai]
 *   AI options: `enabled` lets it answer questions, `explain` lets it rewrite the plain-text summary/open items.
 * @param {boolean} [options.interactive] Prompt on the terminal (see `resolveQuestions`).
 * @param {(q: object, i: number, n: number) => Promise<*>} [options.prompt] Non-terminal answerer (the web UI).
 * @param {(event: string, data: object) => void} [options.emit] Progress callback (`step`, `tree`, `question`,
 *   `answered`, `items`, `layers`, `changes`, `actions`, `summary`, `ai`, `explained`, `ai-log`, `contract`).
 * @param {number} [options.pace] Milliseconds to pause between steps (0 = no pause; used for the demo shell).
 * @returns {Promise<{plan: object, files: Object<string, string>, log: object[], base: string, dynCount: number,
 *   open: object[], spec: object, ai: object|null}>}
 *   The plan, the generated files (by relative path), the Q&A log, the output base directory, the count of
 *   dynamic parts found, the open items, the spec, and AI usage stats (or `null`).
 */
export async function runPipeline({
  dir,
  outRoot,
  useSaved = true,
  askAll = false,
  auto = false,
  ai = null,
  interactive = false,
  prompt = null,
  emit = () => {},
  pace = 0,
}) {
  // feature.json + the contract (openapi.json / .yaml in the folder). No contract is allowed: the run says so and stays honest.
  const spec = readSpec(dir);
  const noContract = !spec.contract.usable;
  const pageSource = fs.readFileSync(path.join(dir, spec.page), "utf8");
  const answersFile = path.join(dir, "answers.json");
  const saved =
    useSaved && fs.existsSync(answersFile)
      ? JSON.parse(fs.readFileSync(answersFile, "utf8"))
      : {};
  const step = (id, status, detail) => emit("step", { id, status, detail });
  // the notice comes first, before any step
  emit("contract", { hasContract: spec.contract.usable, file: spec.contract.file, notice: spec.contract.notice, gaps: spec.contract.gaps.map((g) => g.text) });

  // 1. extract
  step("extract", "running");
  await wait(pace);
  const extracted = extract(pageSource);
  const vm = mergeViewModel(loadViewModel(dir), extracted);
  saveViewModel(dir, vm);
  const viewExtracted = toExtractedShape(vm);
  const list = viewExtracted.lists[0];
  emit("tree", { tree: foundTree(vm, spec) });
  step("extract", "done", {
    values: viewExtracted.values.map((v) => `${v.name} = "${v.example}"`),
    list: list
      ? `${list.name}: ${list.rows.length} rows, fields ${list.fields.join(", ")}`
      : null,
    actions: [
      ...(list?.actions ?? []),
      ...viewExtracted.actions.map((a) => a.name),
    ],
    form: viewExtracted.forms[0]?.fields.map((f) => f.name) ?? [],
  });
  await wait(pace * 1.5);

  // 2. match
  step("match", "running");
  await wait(pace);
  const matched = match(viewExtracted, spec);
  snapshotTies(matched);
  // No contract, or no example in it for the list: nothing to match against, so nothing is asked (or answered by AI) until the contract has what it needs.
  if (matched.block) { auto = true; if (ai?.enabled) ai = { ...ai, enabled: false }; }
  const hints = computeHints(matched);
  const questions = buildQuestions(matched, { all: askAll });
  const aiCtl = ai?.enabled || ai?.explain ? createAi({ dir, spec, source: pageSource, matched, overrides: ai.overrides, trusted: !!ai.trusted, onLog: (e) => emit("ai-log", e) }) : null;
  const decFile = path.join(dir, "decisions.json");
  let prevDec = {};
  try { prevDec = JSON.parse(fs.readFileSync(decFile, "utf8")); } catch {}
  const human = new Set();
  for (const q of questions) {
    q.hint = hints.get(q.id)?.hint;
    q.note = () => noteFor(matched, q.id);
  }
  const tree = buildTree(matched, spec);
  emit("tree", { tree });
  step("match", "done", {
    connected:
      tree.stats.total -
      tree.stats.missing -
      tree.stats.ask -
      tree.stats.placeholder,
    placeholder: tree.stats.placeholder,
    ask: tree.stats.ask,
    missing: tree.stats.missing,
    total: tree.stats.total,
  });
  await wait(pace * 1.5);

  // 3. ask
  step("ask", "running", { count: questions.length, auto, blocked: !!matched.block });
  const ui = prompt
    ? async (q, i, n) => {
        emit("tree", {
          tree: buildTree(matched, spec),
          focus: q.focusId ?? q.id,
        });
        emit("question", {
          id: q.id,
          type: q.type,
          text: q.text,
          options: (q.options ?? []).map((o) => o.label),
          default: q.default,
          hint: q.hint,
          context: questionContext(q, matched, spec),
          note: q.sub ? null : q.note?.(),
          sub: !!q.sub,
          n: i,
          total: n,
          // T12.4: the joint follow-up ("where from? which fields? what's it called?", asked together) needs its
          // own fields and values, not just option labels — sources/itemFields keep their {label, value} shape
          // (none of it is sensitive) so the client can submit {from, inputs, fn} in one answer.
          ...(q.type === "joint" ? { sources: q.sources, itemFields: q.itemFields, suggestedInputs: q.suggestedInputs, defaultName: q.defaultName } : {}),
        });
        return prompt(q);
      }
    : null;
  const { answers, log } = await resolveQuestions(questions, {
    answers: saved,
    interactive,
    prompt: ui,
    auto,
    ai: aiCtl && ai.enabled ? (q) => aiCtl.answer(q) : null,
    onAnswer: async (q, choice, source) => {
      if (source === "you") human.add(q.id);
      const d = aiCtl?.decisions[q.id] ?? (source === "saved" ? prevDec[q.id] : null);
      emit("answered", {
        id: q.id,
        text: q.text,
        answer: choice.label,
        source: d ? "ai" : source,
        evidence: d?.evidence,
        model: d?.model,
      });
      emit("tree", { tree: buildTree(matched, spec) });
      await wait(pace);
    },
  });
  // Only touch answers.json when it really changed, so a file watcher doesn't re-trigger itself.
  const nextAnswers = JSON.stringify(answers, null, 2) + "\n";
  const prevAnswers = fs.existsSync(answersFile)
    ? fs.readFileSync(answersFile, "utf8")
    : null;
  if (Object.keys(answers).length && nextAnswers !== prevAnswers)
    fs.writeFileSync(answersFile, nextAnswers);
  if (aiCtl && ai.enabled) {
    await aiCtl.draft(); // placeholders built from fields: an expression checked against the design's examples
    aiCtl.save();
    const merged = { ...prevDec, ...aiCtl.decisions };
    for (const id of human) delete merged[id];
    const nextDec = JSON.stringify(merged, null, 2) + "\n";
    if (Object.keys(merged).length && nextDec !== JSON.stringify(prevDec, null, 2) + "\n") fs.writeFileSync(decFile, nextDec);
    prevDec = merged;
    emit("ai", { stats: aiCtl.stats, decisions: Object.entries(aiCtl.decisions).map(([id, d]) => ({ id, ...d })) });
  }
  step("ask", "done", {
    count: questions.length,
    skipped: log.filter((l) => l.skipped).length,
    auto,
    blocked: !!matched.block,
  });

  // 4. plan
  step("plan", "running");
  await wait(pace);
  const plan = makePlan(spec, matched);
  const n = plan.names;
  const base = path.join(outRoot, "features", n.feature);
  const open = openItems(matched, hints);
  emit("items", { items: open });
  if (aiCtl && ai.explain && open.length) {
    // the run summary shows each open item in plain words; a fixed template stands in when the model is off or off-script
    emit("explained", { items: await aiCtl.explain(open) });
    aiCtl.save();
  }
  const layers = buildLayers(plan);
  emit("layers", { layers });
  step("plan", "done", {
    layers: plan.layers,
    placeholders: plan.placeholders,
  });
  await wait(pace);

  // 5. emit
  step("emit", "running");
  const { page, component } = rewritePage(pageSource, plan);
  const files = {
    [`route/${n.Feature}Route.jsx`]: emitRoute(plan),
    [`controller/${n.Feature}Controller.jsx`]: emitController(plan),
    [`workflow/${n.feature}.workflow.js`]: emitWorkflow(plan),
    [`service/${n.feature}.service.js`]: emitService(plan),
    [`domain/${n.feature}.domain.js`]: emitDomain(plan),
    [`domain/${n.feature}.domain.test.js`]: emitDomainTest(plan),
    [`page/${n.Feature}Page.jsx`]: page,
    ...(component ? { [`component/${n.Item}Row.jsx`]: component } : {}),
    [`mocks/${n.feature}.mock.js`]: emitMock(plan),
  };

  // Every file written is compared with what was on disk before this run (git-style), for the "what changed" view.
  const changes = [];
  const txn = createWriteTransaction(base); // T16.10: buffer this run's generated files, commit them together
  const writeTracked = (rel, content, { diff = true, buffered = false } = {}) => {
    const file = path.join(base, rel);
    const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (buffered) txn.writeFile(rel, content);
    else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    const d = diffFile(prev, content);
    changes.push({ path: rel, status: d.status, added: d.added, removed: d.removed, hunks: diff ? d.hunks.slice(0, 40) : [], noDiff: !diff });
  };
  for (const [rel, code] of Object.entries(files)) {
    // A TSX page (real Subframe export) keeps its type annotations in the generated Page file, so it needs the TS parser.
    writeTracked(rel, await prettier.format(code, { parser: /\.tsx?$/.test(spec.page) ? "babel-ts" : "babel", printWidth: 100 }), { buffered: true });
  }
  // Nothing above touched disk; either every generated file for this feature lands now, or (had something
  // thrown first, e.g. a template bug) none of them would.
  txn.commit();

  // ---------- report ----------
  const dynCount =
    viewExtracted.values.length + (viewExtracted.lists[0]?.fields.length ?? 0);
  const r = [];
  r.push(`# line-matcher report: ${n.feature}\n`);
  if (spec.contract.notice) r.push(`> **${spec.contract.notice}**${noContract ? " Until then every part that needs the API stays open and the generated code is stubs." : ""}\n`);
  r.push(
    `**Dynamic parts found:** ${dynCount} (${viewExtracted.values.length} page values, ${viewExtracted.lists[0]?.fields.length ?? 0} list fields) · **Actions:** ${plan.actions.length} · **Questions asked:** ${matched.block ? 0 : log.length}\n`,
  );
  r.push(`## Matches\n`);
  r.push(`| Part | Design showed | Comes from |\n|---|---|---|`);
  const waiting = matched.block ? (noContract ? "no API contract yet" : "no example in the contract") : "skipped — answer later";
  for (const v of plan.values)
    r.push(
      `| ${v.name} | ${v.example} | ${v.static ? "static text" : v.skipped ? waiting : v.todo ? "TODO — not in API" : v.custom ? `placeholder ${v.fn}()` : `${v.agg}${v.field ? `(${v.field})` : ""} → ${v.formatter}`} |`,
    );
  for (const f of plan.rowFields)
    r.push(
      `| row.${f.name} | ${f.examples.join(", ")} | ${f.field ? `${f.field} → ${f.formatter}` : f.skipped ? waiting : f.todo ? "TODO — not in API" : f.custom ? `placeholder ${f.fn}()` : "static text"} |`,
    );
  if (plan.rowFields.length)
    r.push(`| row order | — | ${plan.sort.label ?? "API order"} |`);
  r.push(`\n## Actions\n`);
  r.push(`| Action | Where | Does |\n|---|---|---|`);
  for (const a of plan.actions)
    r.push(
      `| ${a.name} | ${a.scope} | ${a.kind === "custom" ? `placeholder ${a.fn}()` : a.kind} |`,
    );
  if (aiCtl && Object.keys(prevDec).length) {
    r.push(`\n## AI decisions to review\n`);
    for (const [id, d] of Object.entries(prevDec)) r.push(`- **${id}** → ${d.answer}\n  ${d.model}: ${d.evidence}`);
  }
  if (open.length) {
    r.push(`\n## Open items — what would close them\n`);
    for (const o of open)
      r.push(`- **${o.part}** (${o.state}) — ${o.why}\n  → ${o.hint}`);
  }
  if (!matched.block && log.some((l) => l.skipped)) {
    r.push(`\n## Skipped — answer later\n`);
    for (const l of log.filter((l) => l.skipped)) r.push(`- ${l.question}`);
  }
  if (plan.placeholders.length) {
    r.push(`\n## Placeholders to fill in\n`);
    r.push(`| Part | Function | Layer | Input |\n|---|---|---|---|`);
    for (const p of plan.placeholders)
      r.push(
        `| ${p.part} | ${p.fn}() | ${p.layer} | ${p.from === "fields" ? p.inputs.join(", ") : p.from === "api" ? "new API endpoint" : p.from === "controller" ? "controller" : "your handler"} |`,
      );
  }
  r.push(`\n## Layers (${plan.layers.length})\n`);
  for (const l of plan.layers) r.push(`- **${l.name}** — ${l.why}`);
  if (log.length && !matched.block) {
    r.push(`\n## Questions & answers\n`);
    for (const q of log)
      r.push(
        `- ${q.question}\n  → ${q.answer}`,
      );
  }
  const gaps = [
    ...plan.gaps,
    ...(plan.form?.missing ?? []).map(
      (k) => `The API expects "${k}" but the form has no input for it.`,
    ),
  ];
  if (gaps.length) {
    r.push(`\n## Gaps\n`);
    for (const g of gaps) r.push(`- ${g}`);
  }
  if (spec.contract.gaps.length) {
    r.push(`\n## Contract gaps (${spec.contract.file})\n`);
    for (const g of spec.contract.gaps) r.push(`- ${g.text}`);
  }
  r.push(`\n## Files\n`);
  for (const rel of Object.keys(files))
    r.push(`- features/${n.feature}/${rel}`);
  writeTracked("REPORT.md", r.join("\n") + "\n");
  writeTracked("REPORT.html", renderTreeHtml(matched, spec, layers), { diff: false });
  writeTracked("status.json", JSON.stringify({ feature: n.feature, ...(spec.contract.notice ? { contract: spec.contract.notice } : {}), open: open.length, items: open }, null, 2) + "\n");
  emit("changes", { feature: n.feature, base: path.join("features", n.feature), files: changes, placeholders: plan.placeholders });
  // Action items by team, with the email each team would get (fixed text, no model).
  const teams = buildActions({ open, visuals: viewExtracted.visuals, matched, spec }).map((t) => ({ ...t, email: t.items.length ? composeEmail(t, n.feature, spec) : null }));
  emit("actions", { feature: n.feature, teams });
  // The summary page, block by block: fixed text always, rewritten by the model when explaining is on.
  const blocks = summaryBlocks({ stats: buildTree(matched, spec).stats, log, open, changes, ai: aiCtl?.stats ?? null, teams, contract: spec.contract });
  emit("summary", { blocks: aiCtl && ai.explain ? await aiCtl.summarizeBlocks(blocks) : blocks.map((b) => ({ key: b.key, title: b.title, attention: b.attention, text: b.template, by: "template", model: null })) });
  aiCtl?.save();
  step("emit", "done", {
    base,
    files: [...Object.keys(files), "REPORT.md", "REPORT.html"].map(
      (f) => `features/${n.feature}/${f}`,
    ),
  });
  return { plan, files, log, base, dynCount, open, spec, ai: aiCtl?.stats ?? null };
}
