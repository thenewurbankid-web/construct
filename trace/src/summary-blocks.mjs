// The run summary, block by block. Each block has its own small set of facts (its "scoped context"), a fixed
// template sentence, and an attention level chosen by rule. A model may rewrite the sentence (see
// ai/index.mjs summarizeBlocks) but sees only that block's facts, so it cannot mix in anything else.
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * Build the run summary as a sequence of blocks (contract, connections, questions, code, layers, still-open,
 * actions by team, what needs you next, and AI when used). Each block carries its own facts, a fixed template
 * sentence, and an attention level (`"ok"|"warn"|"bad"`) chosen by rule, so a later rewrite of the sentence
 * (see `ai/index.mjs` `summarizeBlocks`) only ever sees that block's own facts.
 *
 * @param {object} run
 * @param {object} run.stats Connection stats: `total`, `missing`, `ask`, `placeholder`.
 * @param {object[]} run.log Question/answer log entries (`source`, `skipped`, `question`).
 * @param {object[]} run.open Still-open items (`part`, `state`).
 * @param {object[]} run.changes Generated-file diffs (`path`, `status`, `added`, `removed`).
 * @param {{calls: number, cached: number, answered: number, skipped: number, msTotal: number, errors: any[]}|null} [run.ai]
 *   AI usage for the run, or `null`/omitted when no model was used.
 * @param {{key: string, label: string, items: any[]}[]} [run.teams] Action items grouped by team.
 * @param {{notice: string, file: string|null}|null} [run.contract] Contract problem to report first, if any.
 * @returns {{key: string, title: string, facts: string, template: string, attention: "ok"|"warn"|"bad"}[]}
 *   The blocks, in the fixed display order.
 */
export function summaryBlocks({ stats, log, open, changes, ai, teams = [], contract = null }) {
  const blocks = [];
  const add = (key, title, facts, template, attention) => blocks.push({ key, title, facts: facts.join("\n"), template, attention });

  // the contract notice comes first, so a run without one is never read as a run with few problems
  if (contract?.notice) add("contract", "API contract", [`contract file: ${contract.file ?? "none"}`, "problem: the API contract is missing or unusable"], contract.notice, "bad");

  // connections
  const conn = stats.total - stats.missing - stats.ask - stats.placeholder;
  add("connections", "Connections",
    [`parts on the page: ${stats.total}`, `complete: ${conn}`, `waiting for an answer: ${stats.ask}`, `placeholders: ${stats.placeholder}`, `nothing behind them in the API: ${stats.missing}`],
    `${conn} of ${stats.total} connections are complete${stats.missing ? `; ${stats.missing} have nothing behind them in the API` : ""}${stats.ask ? `; ${stats.ask} are waiting for an answer` : ""}${stats.placeholder ? `; ${stats.placeholder} are placeholders` : ""}.`,
    stats.missing ? "bad" : stats.ask || stats.placeholder ? "warn" : "ok");

  // questions
  const by = (k) => log.filter((a) => a.source === k).length;
  const skipped = log.filter((a) => a.skipped).length, answered = log.length - skipped;
  const skippedParts = log.filter((a) => a.skipped).slice(0, 5).map((a) => a.question.match(/"([^"]+)"/)?.[1]).filter(Boolean);
  add("questions", "Questions",
    [`questions asked: ${log.length}`, `answered: ${answered}`, `skipped: ${skipped}`, ...(skippedParts.length ? [`skipped parts: ${skippedParts.join(", ")}`] : [])],
    log.length ? `${answered} of ${log.length} questions were answered${skipped ? `, ${skipped} skipped` : ""}.` : "Nothing needed a question: every part matched.",
    skipped ? "warn" : "ok");

  // code
  const changed = changes.filter((f) => f.status !== "unchanged");
  const added = changed.filter((f) => f.status === "added").length, modified = changed.filter((f) => f.status === "modified").length;
  const plus = changed.reduce((n, f) => n + f.added, 0), minus = changed.reduce((n, f) => n + f.removed, 0);
  const layers = [...new Set(changed.map((f) => (f.path.includes("/") ? f.path.split("/")[0] : "reports")))];
  add("code", "Code",
    [`files changed: ${changed.length}`, `new files: ${added}`, `modified files: ${modified}`, `lines added: ${plus}`, `lines removed: ${minus}`, `layers touched: ${layers.join(", ") || "none"}`],
    changed.length ? `${plural(changed.length, "file")} changed (${added} new, ${modified} modified), +${plus} −${minus}.` : "No generated file changed since the previous run.",
    "ok");

  // files by layer
  const perLayer = layers.map((l) => [l, changed.filter((f) => (f.path.includes("/") ? f.path.split("/")[0] : "reports") === l).length]);
  add("layers", "Files by layer", perLayer.map(([l, n]) => `${l}: ${plural(n, "changed file")}`), perLayer.length ? `Changes are in ${perLayer.map(([l]) => l).join(", ")}.` : "No layer changed.", "ok");

  // still open
  const count = (f) => open.filter(f).length;
  const blockers = count((o) => o.state === "missing" || o.state === "gap"), risks = count((o) => o.state === "tie"), decisions = count((o) => o.state === "skipped"), stubs = count((o) => o.state === "placeholder");
  add("open", "Still open",
    [`open items: ${open.length}`, `blockers (missing API or contract gap): ${blockers}`, `ties that could be answered wrongly: ${risks}`, `skipped decisions: ${decisions}`, `placeholders to write: ${stubs}`],
    open.length ? `${plural(open.length, "item")} still open: ${[blockers && `${blockers} blocker${blockers === 1 ? "" : "s"}`, risks && `${plural(risks, "tie")}`, decisions && `${plural(decisions, "skipped decision")}`, stubs && `${plural(stubs, "placeholder")}`].filter(Boolean).join(", ")}.` : "Nothing is open.",
    blockers ? "bad" : open.length ? "warn" : "ok");

  // action items by team
  const active = teams.filter((t) => t.items.length);
  add("actions", "Action items by team", teams.map((t) => `${t.label}: ${plural(t.items.length, "action item")}`), active.length ? `${active.map((t) => `${t.label} ${t.items.length}`).join(", ")} action items.` : "No team has an action item.", active.some((t) => t.key === "backend" && t.items.length) ? "bad" : active.length ? "warn" : "ok");

  // what needs you next
  const top = open.slice(0, 5);
  add("next", "What needs you next",
    top.map((o, i) => `${i + 1}. ${o.part}: ${o.state}`),
    top.length ? `Start with "${top[0].part}", then ${top.slice(1, 3).map((o) => `"${o.part}"`).join(" and ") || "the rest"}.` : "Nothing needs you.",
    top.length ? "warn" : "ok");

  // AI
  if (ai) {
    add("ai", "AI",
      [`model calls: ${ai.calls}`, `from cache: ${ai.cached}`, `answers accepted: ${ai.answered}`, `skipped: ${ai.skipped}`, `time: ${(ai.msTotal / 1000).toFixed(1)} s`, ...(ai.errors.length ? [`errors: ${ai.errors.length}`] : [])],
      `${plural(ai.calls, "model call")} took ${(ai.msTotal / 1000).toFixed(1)} s${ai.cached ? `; ${ai.cached} came from the cache` : ""}${ai.errors.length ? `; ${plural(ai.errors.length, "call")} failed` : ""}.`,
      ai.errors.length ? "bad" : "ok");
  }
  return blocks;
}
