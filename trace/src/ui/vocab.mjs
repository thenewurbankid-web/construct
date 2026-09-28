// The demo's vocabulary, defined once. The pipeline keeps its own words (connected, missing, question, placeholder,
// re-run, team action, run summary); everything the demo shell shows goes through this file, so the two vocabularies
// meet in one place and the mapping is testable. Pure functions only: it runs in the browser and in node.
export const PRODUCT = {
  name: "Trace", // the one constant to change when the product is renamed
  tagline: "Give Trace the design and the API. It wires the screen and tells each team what doesn't fit.",
};
export const PATTERN_SENTENCE =
  `${PRODUCT.name} finds the seams. Each is a Fit, a Gap or a Tie. Gaps and Ties become Asks, which you answer or Suggest answers. Answers go in the Ledger, so a Replay gives the same result. Each team gets a Handoff.`;

// word: what the demo shows. was: what the pipeline (and the studio) call it. from: where that shows up in the pipeline.
export const TERMS = {
  seam:      { word: "Seam",       was: null,             from: null,                       def: "A place where design, API and product meet and may not fit." },
  fit:       { word: "Fit",        was: "connected",      from: "tree state ok / static",   def: "A part the contract reproduces exactly." },
  wait:      { word: "Waiting",    was: "unanswered question", from: "tree state ask with no candidates, or missing while its Ask is open", def: "A part that is waiting for your answer. Nothing is wrong with it yet.", phrase: "Waiting for you" },
  gap:       { word: "Gap",        was: "missing",        from: "tree state missing (settled)", def: "A part with nothing behind it, confirmed." },
  tie:       { word: "Tie",        was: "tie",            from: "tree state ask (candidates)", def: "Two explanations fit equally well." },
  ask:       { word: "Ask",        was: "question",       from: "SSE event question",       def: "A Gap or a Tie turned into a question with concrete options." },
  stub:      { word: "Stub",       was: "placeholder",    from: "tree state placeholder",   def: "An honest, marked stand-in for something that doesn't exist yet." },
  suggest:   { word: "Suggest",    was: "AI answer",      from: "answered.source ai",       def: "The AI proposes an answer that rules check." },
  ledger:    { word: "Ledger",     was: "answers.json / decisions.json", from: "SSE event answered", def: "Every decision, recorded with who or what made it." },
  replay:    { word: "Replay",     was: "re-run",         from: "a new run with saved answers", def: "Run again from scratch, same output." },
  handoff:   { word: "Handoff",    was: "team action",    from: "SSE event actions",        def: "What a team must do, plus the ready email." },
  fitReport: { word: "Fit report", was: "run summary",    from: "SSE event summary / done", def: "The summary of a run." },
};

// Tree leaf states (src/tree/model.mjs) and open-item states (src/hints.mjs) in demo words.
// "ask" is refined by leafState(): a leaf with several candidates is a Tie, anything else that is asked is Waiting (an Ask is open).
// A Gap is only ever a part that is settled as having nothing behind it: answered "not in the API yet", or missing with no question to ask.
export const STATE_TERM = { ok: "fit", static: "fit", missing: "gap", ask: "tie", placeholder: "stub" };
export const ITEM_TERM = { missing: "gap", gap: "gap", tie: "tie", placeholder: "stub" }; // "skipped" takes the term of what was wrong (origin)
export const EVENT_TERM = { question: "ask", answered: "ledger", actions: "handoff", summary: "fitReport", done: "fitReport" };
export const STATES = ["fit", "wait", "gap", "tie", "stub"]; // the order everything in the shell lists them in: legend, ring, canvas rail

// Words that must not reach the demo path (the studio keeps them). Checked by the tests.
export const BANNED = ["transform", "tree", "layer", "formatter", "console", "envelope", "token", "prompt"];
export const bannedIn = (text) => BANNED.filter((w) => new RegExp(`\\b${w}s?\\b`, "i").test(String(text ?? "")));

// A last-resort net for text the pipeline wrote for the studio: the demo shows it in demo words.
const SCRUB = [
  [/\bplaceholders?\b/gi, (m) => (/s$/i.test(m) ? "Stubs" : "Stub")],
  [/\b(?:the )?(?:domain|service|controller|workflow|page|component) layers?\b/gi, "the app"],
  [/\blayers?\b/gi, "area"],
  [/\btransforms?\b|\btransformations?\b/gi, "conversion"],
  [/\bformatters?\b/gi, "format"],
  [/\benvelope\b/gi, "response"],
  [/\bstubs?\b/g, (m) => (m === "stub" ? "Stub" : "Stubs")],
];
export const scrub = (text) => SCRUB.reduce((t, [re, to]) => t.replace(re, to), String(text ?? ""));

const RANK = { ok: 0, static: 1, placeholder: 2, ask: 3, missing: 4 };
const worstCell = (leaf) => {
  const cells = (leaf.cells ?? []).filter(Boolean);
  return cells.reduce((a, c) => (RANK[c.state] > RANK[a.state] ? c : a), cells[0] ?? { state: "ok", title: "" });
};
// A skipped Ask is still open, so it is Waiting (or a Tie, when two fields fit equally); it is not a Gap until someone settles it.
export const itemTerm = (it) => (it.state === "skipped" ? (it.origin === "tie" ? "tie" : "wait") : ITEM_TERM[it.state] ?? "gap");

// The pipeline (src/tree/model.mjs) marks a red cell `waiting: true` when the part's Ask has not been answered yet: a value or a row part
// with no candidate ("not in API"), or a button whose endpoint the contract lacks (its Ask is "what should the button do?"). Both are
// Waiting. The same red cells with no Ask behind them (no contract, an input the API lacks, an answered "not in the API yet") carry no
// flag and stay a Gap. This reads the flag, never the words of the cell, so rewording the pipeline's text cannot flip a Gap into Waiting.
const needsAnswer = (leaf) => (leaf.cells ?? []).some((c) => c?.waiting === true);

// One part of the page as Fit, Waiting, Gap, Tie or Stub. items (open items by id) and prev (the term this part had before it
// was skipped) settle a part that was skipped: it is still whatever was open about it.
export function leafState(leaf, { items = {}, prev = null } = {}) {
  const w = worstCell(leaf);
  if (w.state === "missing") return needsAnswer(leaf) ? "wait" : "gap";
  if (w.state !== "ask") return STATE_TERM[w.state] ?? "fit";
  const many = /^(\d+) possible/.exec(w.title);
  if (many) return Number(many[1]) > 1 ? "tie" : "wait";
  if (/skipped for now/.test(w.title)) return (items[leaf.id] && itemTerm(items[leaf.id])) || prev || "wait";
  return "wait"; // no sort, or a button with an unknown verb: an Ask is open
}

export function summarize(tree, { items = {}, prev = {} } = {}) {
  const states = {}, s = { total: 0, fit: 0, wait: 0, gap: 0, tie: 0, stub: 0 };
  for (const g of tree?.groups ?? []) for (const leaf of g.leaves) {
    const t = leafState(leaf, { items, prev: prev[leaf.id] });
    states[leaf.id] = t;
    s.total++; s[t]++;
  }
  s.needHuman = s.total - s.fit;
  return { ...s, states };
}

export const plural = (n, term) => `${n} ${TERMS[term].word}${n === 1 ? "" : "s"}`;
// What is still open, in the order the shell lists it everywhere: waiting for you, gaps, ties, stubs.
// lower: the headline's plain lower case ("3 gaps"); otherwise the pattern words ("3 Gaps").
const OPEN_ORDER = ["wait", "gap", "tie", "stub"];
export const openParts = (s, { lower = false } = {}) => OPEN_ORDER.filter((k) => s?.[k]).map((k) => {
  if (k === "wait") return `${s[k]} waiting for you`;
  const w = TERMS[k].word, n = s[k];
  return `${n} ${lower ? w.toLowerCase() : w}${n === 1 ? "" : "s"}`;
});
// "8 of 29 parts fit · 18 waiting for you · 3 gaps". Every count is a part of the design (two buttons with one name are two parts).
export function headline(s) {
  if (!s?.total) return "";
  if (!s.needHuman) return `All ${s.total} parts fit`;
  const open = openParts(s, { lower: true });
  return [`${s.fit} of ${s.total} parts fit`, ...(open.length ? open : [`${s.needHuman} ${s.needHuman === 1 ? "needs" : "need"} a human`])].join(" · ");
}
export const breakdown = (s) => openParts(s).join(" · ");

// Items that repeat (two buttons with the same name give two identical items) are shown once with a count: [{ item, count }],
// in the order of the first of each. Same part id and same title make two items one.
export function groupItems(items) {
  const seen = new Map(), out = [];
  for (const item of items ?? []) {
    const key = `${item.id}\u0000${item.title}`, g = seen.get(key);
    if (g) g.count++; else { const e = { item, count: 1 }; seen.set(key, e); out.push(e); }
  }
  return out;
}

// ---- Asks, in plain words ----
export const humanize = (name) => {
  const w = String(name ?? "").replace(/^(?:row|value|list|action)\./, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_.\-]+/g, " ").trim().toLowerCase();
  return w ? w[0].toUpperCase() + w.slice(1) : "This part";
};

// "*x*" marks the part the Ask is about (the shell italicises it). kind picks the colour: tie, gap or stub (a follow-up).
export function askTitle(q) {
  const id = String(q.id ?? "").split("#")[0], ctx = q.context ?? {};
  if (q.sub) return { kind: "stub", text: scrub(q.text).replace(/"([^"]+)"/g, "*$1*") };
  if (id === "list.sort") return { kind: "tie", text: "How should the rows be ordered?" };
  if (id.startsWith("action.")) {
    const name = id.split(".")[2]; // the button as the design spells it (a button called "suggest" is not a Suggest)
    return { kind: "gap", text: /wasn't given/.test(q.text ?? "") ? `The API can't do *${name}* yet. What should the button do?` : `What should *${name}* do?` };
  }
  const part = humanize(ctx.label ?? id);
  if ((ctx.candidates?.length ?? 0) > 1) return { kind: "tie", text: id.startsWith("value.") ? `Which of these is *${part}*?` : `Which field is *${part}*?` };
  return { kind: "gap", text: `Nothing in the API gives *${part}*. What is it?` };
}

const OPTION_MAP = [
  [/^data the API doesn't provide yet/i, "Not in the API yet, leave it as a Gap"],
  [/^static text/i, "Just fixed text, not data"],
  [/^something else — build a placeholder/i, "Something else, make it a Stub…"],
  [/^something else — name my own handler/i, "Something else, name my own handler (a Stub)…"],
  [/^combine values from API fields/i, "Combine API fields (a Stub)"],
  [/^provided by the controller/i, "The app supplies it (a Stub)"],
  [/^a new API endpoint that doesn't exist yet/i, "A new endpoint that doesn't exist yet (a Stub)"],
];
export function plainOption(label) {
  const raw = String(label ?? "");
  for (const [re, to] of OPTION_MAP) if (re.test(raw)) return to;
  const base = raw.replace(/, shown as \w+$/, "").replace(/ shown as \w+$/, "");
  let m;
  if ((m = /^API field "([^"]+)"$/.exec(base))) return `The field ${m[1]}`;
  if ((m = /^response field "([^"]+)"$/.exec(base))) return `The field ${m[1]}`;
  if (/^count of the list$/.test(base)) return "The number of rows";
  if ((m = /^(sum|average|min|max)\(([^)]+)\) of the list$/.exec(base))) return `The ${m[1]} of ${m[2]}`;
  if ((m = /^(\w+)\(([^)]*)\) of the list$/.exec(base))) return `The ${m[1]} of ${m[2] || "the rows"}`;
  return scrub(raw);
}
// A candidate in the Ask's context: "sum(value) · moneyCompact" -> "sum of value" (the format name is not for people).
export function plainCandidate(label) {
  const base = String(label ?? "").replace(/ · \w+$/, "");
  let m;
  if ((m = /^field (.+)$/.exec(base))) return m[1];
  if ((m = /^(\w+)\(([^)]*)\)$/.exec(base))) return m[2] ? `${m[1]} of ${m[2]}` : `${m[1]} of the rows`;
  return scrub(base);
}

// Titles of open items come from the pipeline's fixed templates: '"row.status" has nothing behind it', '"delete (row action)"'.
export function plainTitle(title) {
  return scrub(String(title ?? ""))
    .replace(/"([^"]+?) \((?:row|page) action\)"/g, 'the “$1” button') // curly quotes: keeps the button's own name as the design spells it (a button called "suggest" is not a Suggest)
    .replace(/"input (\w+)"/g, 'the “$1” input')
    .replace(/"(?:row|value)\.(\w+)"/g, (_, n) => `"${humanize(n)}"`)
    .replace(/"([A-Za-z][A-Za-z0-9 ]{0,39})"/g, (_, n) => `"${humanize(n)}"`) // a bare part name: baselineSpend -> Baseline spend
    .replace(/^the /, "The ");
}

// An open Ask is worded as waiting, not as a defect: '"Rank" has nothing behind it in the API' becomes '"Rank" is waiting for an answer'.
export const waitingTitle = (title) => plainTitle(title).replace(/ has nothing behind it(?: in the API)?/, " is waiting for an answer");

// The email text comes from the pipeline (fixed text, no model). Two display fixes only: the footer names this product, and a line
// that printed the word "undefined" (a candidate list for a part answered "not in the API yet") is left out rather than sent to a team.
export const cleanEmail = (body, name = PRODUCT.name) =>
  String(body ?? "").replace(/\(generated from the (?:line-matcher|Trace) run summary\)/, `(sent from ${name})`).split("\n").filter((l) => !/\bundefined\b/.test(l)).join("\n");

export const BY = { you: "You", saved: "Saved earlier", ai: "Suggest", default: "Default", skipped: "Skipped" };
export const byLabel = (source) => BY[source] ?? "You";

export const TEAMS = ["backend", "product", "design", "frontend"];
export const TEAM_LABEL = { backend: "Backend", product: "Product", design: "Design", frontend: "Frontend" };
export const TEAM_SCOPE = {
  backend: "Endpoints, fields and the contract",
  product: "Decisions: which field means what",
  design: "Components and inputs the design lacks",
  frontend: "Stubs to write and wiring",
};
