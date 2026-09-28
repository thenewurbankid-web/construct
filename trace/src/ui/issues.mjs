// The issue registry: what can be wrong with a part of the page, in plain words, and how it is fixed.
// One entry per KIND. A new kind (coincidence risk, coupled with N others, no recipe) is one more entry here and,
// if it needs its own fix, one more form in FORMS: the badge, the inspector header, the Handoff items and the studio
// all read this file, so nothing else changes. Pure data and pure functions: it runs in the browser and in node.
//
//   label     the short word on a badge
//   words     the plain-language reason, shown next to the label ("Gap: nothing in the API")
//   color     a colour token of the demo's theme (never a literal colour)
//   icon      a name of ui/icons.mjs
//   explain   two sentences for the inspector: what it means and what closes it
//   form      which QUESTION FORM fixes it (a key of FORMS)
//   team      who usually closes it, for the Handoff
export const ISSUES = {
  gap: {
    label: "Gap", words: "nothing in the API", color: "var(--gap)", icon: "gap", form: "leave-or-stub", team: "backend",
    explain: "No field, count or total in the API gives what the design shows. Leave it as a Gap so the team that owns the API sees it, or make a Stub so the screen still works.",
  },
  tie: {
    label: "Tie", words: "two fields fit equally", color: "var(--tie)", icon: "tie", form: "which-field", team: "product",
    explain: "More than one field reproduces the design exactly on the example data, so the rules cannot tell which is meant. Pick the one you mean, and the choice is recorded.",
  },
  stub: {
    label: "Stub", words: "placeholder to write", color: "var(--stub)", icon: "stub", form: "confirm-or-pick", team: "frontend",
    explain: "This part is an honest, marked stand-in that someone still has to write. You can keep it, give it an expression that reproduces the design, or go back to a Gap.",
  },
  ask: {
    label: "Ask", words: "waiting for you", color: "var(--wait)", icon: "wait", form: "same-as-underlying", team: "product",
    explain: "Nobody has decided this yet, so it is still open. The choices are the same as for the Gap or Tie underneath.",
  },
  noEndpoint: {
    label: "No endpoint", words: "the API can't do this yet", color: "var(--gap)", icon: "plug", form: "which-endpoint", team: "backend",
    explain: "The button needs an endpoint that the contract does not have. Backend can add it, or you can choose what the button does with the endpoints that exist.",
  },
  formInput: {
    label: "Input the API lacks", words: "form input the API lacks", color: "var(--gap)", icon: "gap", form: "info", team: "backend",
    explain: "The design has this input, but no example request in the contract carries it, so its value would be dropped. It is closed in the contract or the design, not by an answer here.",
  },
  noInput: {
    label: "No input", words: "the API expects it, the design lacks it", color: "var(--gap)", icon: "gap", form: "info", team: "design",
    explain: "The API expects this value but the design's form has no input for it. It is closed in the design or the contract, not by an answer here.",
  },
  // The Page map's two kinds (src/pagemap/): text the rules could not place, and text where they disagree.
  unclassified: {
    label: "Unclassified text", words: "no rule placed it", color: "var(--muted)", icon: "gap", form: "data-or-copy", team: "design",
    explain: "No rule fired for this text and there is no API example to compare it with, so it is only assumed to be fixed wording. Say whether it is data from the API or fixed copy, and the choice is recorded.",
  },
  ambiguous: {
    label: "Ambiguous", words: "dynamic or copy?", color: "var(--tie)", icon: "tie", form: "data-or-copy", team: "product",
    explain: "The rules point both ways: the text looks like data (it mentions an API value, or sits next to a number) but could be fixed copy. Pick the one you mean, and the choice is recorded.",
  },
};
export const KINDS = Object.keys(ISSUES);
export const issue = (kind) => ISSUES[kind] ?? null;

// The question forms. groups is the order in which option groups appear, a fixed rule (see inspector/options.mjs).
export const FORMS = {
  "confirm-or-pick": { title: "Keep this, or choose another", groups: ["candidates", "gap", "stub", "static"] },
  "which-field": { title: "Which one is meant?", groups: ["candidates", "gap", "stub"] },
  "pick-recipe": { title: "Which recipe gives it?", groups: ["candidates", "gap", "stub"] },
  "leave-or-stub": { title: "Leave it open, or write a Stub", groups: ["gap", "stub", "static"] },
  "which-endpoint": { title: "What should the button do?", groups: ["kinds", "handler"] },
  "which-sort": { title: "How should the rows be ordered?", groups: ["sorts"] },
  info: { title: "Closed outside this screen", groups: [] },
  "data-or-copy": { title: "Is this data, or fixed wording?", groups: [] }, // the Page map answers it with two choices, not option groups
};

// Which kind of trouble one part of the tree is in, or null when it fits. leaf: { id, cells: [part, step, api] } as the
// tree model builds it. Reading the cells' own wording keeps this in step with src/tree/model.mjs (the tests pin it).
const RANK = { ok: 0, static: 1, placeholder: 2, ask: 3, missing: 4 };
export function classify(leaf) {
  const id = leaf.id, cells = (leaf.cells ?? []).filter(Boolean);
  const worst = cells.reduce((a, c) => (RANK[c.state] > RANK[a.state] ? c : a), cells[0] ?? { state: "ok", title: "" });
  if (/^form\.missing\./.test(id)) return "noInput";
  if (/^form\./.test(id)) return worst.state === "missing" ? "formInput" : null;
  if (/^gap\./.test(id)) return "gap";
  if (id.startsWith("action.") && (leaf.cells?.[2]?.title ?? "") === "endpoint missing") return "noEndpoint";
  if (worst.state === "ok" || worst.state === "static") return null;
  if (cells.some((c) => /skipped for now/.test(c.title))) return "ask";
  if (worst.state === "placeholder") return "stub";
  if (worst.state === "missing") return "gap";
  const many = /^(\d+) possible/.exec(worst.title);
  return many && Number(many[1]) > 1 ? "tie" : "gap";
}

// A skipped part is an Ask; what is underneath it (a Gap or a Tie) decides which form fixes it.
// A button whose endpoint the contract lacks is still a "no endpoint" while it waits (its open item says the API "wasn't given").
export const underlying = (kind, item) => (kind === "ask" ? (item?.origin === "tie" ? "tie" : /^action\./.test(item?.id ?? "") && /wasn't given/.test(item?.why ?? "") ? "noEndpoint" : "gap") : kind);
export const formFor = (kind, item) => ISSUES[underlying(kind, item)]?.form ?? "info";

// The badge, as HTML. size "s" is the word only (on the page, where space is short), "m" adds the reason.
// A skipped part is an Ask, and an open Ask is not a defect: it is one amber "Ask · waiting for you" badge. Only when the two
// fields that fit equally are what is open (a Tie underneath) does the Tie show too, with a dashed edge, and in size "m" the Ask chip.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function badgeHtml(kind, { size = "m", under = null } = {}) {
  const k = issue(kind);
  if (!k) return "";
  if (kind === "ask" && under !== "tie") {
    const why = under === "noEndpoint" ? "The API can't do this yet." : "Nothing in the API gives this yet.";
    return `<span class="ibg ibg-ask ibg-${size}" style="--ib:${k.color}" title="${esc(`${k.label}: ${k.words}. ${why}`)}"><b>${size === "s" ? k.label : `${k.label}<span class="ibg-w"> · ${esc(k.words)}</span>`}</b></span>`;
  }
  const shown = kind === "ask" ? issue(under ?? "gap") : k, sk = kind === "ask" ? (under ?? "gap") : kind;
  const text = size === "s" ? shown.label : `${shown.label}<span class="ibg-w"> · ${esc(shown.words)}</span>`;
  const tip = kind === "ask" ? `${shown.label}: ${shown.words}. Waiting for you.` : `${shown.label}: ${shown.words}`;
  const one = `<span class="ibg ibg-${sk} ibg-${size}${kind === "ask" ? " ibg-waiting" : ""}" style="--ib:${shown.color}" title="${esc(tip)}"><b>${text}</b></span>`;
  return kind === "ask" && size !== "s" ? `${one}<span class="ibg ibg-ask ibg-${size}" style="--ib:${k.color}" title="${esc(k.explain)}"><b>${k.label}<span class="ibg-w"> · ${esc(k.words)}</span></b></span>` : one;
}
