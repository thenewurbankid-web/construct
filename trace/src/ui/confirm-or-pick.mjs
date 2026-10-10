// The dedicated rendering for the "confirm-or-pick" Ask form (docs/T23.md): a single-candidate match the
// structural gate (--structural) flagged as possibly coincidental, where the design's own words didn't vouch for
// it. Pulled into its own pure module (no DOM) so it can be unit-tested directly, the same way src/ui/issues.mjs's
// badgeHtml and src/ui/inspector/inspector.mjs's partListHtml are — demo.mjs's askCard() just wires this in.
//
// Shape (src/questions/forms.mjs FORMS["confirm-or-pick"].options): option 0 is "Confirm: …", then zero or more
// "Pick instead: …" alternatives, then the exact "Leave it as a gap — a TODO to answer later", then whatever
// withTail()/ask.mjs append after that (a trailing static-text option, "something else", …). Everything is found
// by matching the label text rather than by counting, so the tail is never assumed to be a fixed length.
import { icon } from "./icons.mjs";
import { plainOption } from "./vocab.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const GAP_LABEL = "Leave it as a gap — a TODO to answer later";

export const isConfirmOrPick = (q) => q?.form === "confirm-or-pick";

// Split q.options (already label strings by the time pipeline.mjs emits them) into the three groups the form
// promises, plus anything else (the trailing static option, "something else", …) left in its original order.
export function groupConfirmOrPick(options) {
  const groups = { confirm: null, alts: [], gap: null, other: [] };
  (options ?? []).forEach((o, i) => {
    const label = plainOption(o);
    if (groups.confirm === null && /^Confirm: /.test(label)) groups.confirm = { i, label };
    else if (/^Pick instead: /.test(label)) groups.alts.push({ i, label });
    else if (groups.gap === null && label === GAP_LABEL) groups.gap = { i, label };
    else groups.other.push({ i, label });
  });
  return groups;
}

// The body markup for askCard(q) when q.form === "confirm-or-pick" — used instead of the generic `.opts` button
// list. Keeps the same `data-answer="<index>"` contract (index into q.options) so submitAnswer's wiring is unaffected.
export function confirmOrPickBody(q, { busy = false } = {}) {
  const g = groupConfirmOrPick(q.options);
  const btn = (i, label, cls) =>
    `<button class="opt ${cls}" type="button" data-answer="${i}" ${busy ? "disabled" : ""}><kbd>${i + 1}</kbd><span>${esc(label)}</span></button>`;
  const confirm = g.confirm ? btn(g.confirm.i, g.confirm.label, "cop-confirm") : "";
  const alts = g.alts.length
    ? `<div class="cop-alts"><span class="cop-label">Pick another explanation</span>${g.alts.map((a) => btn(a.i, a.label, "cop-alt")).join("")}</div>`
    : "";
  const gap = g.gap ? btn(g.gap.i, g.gap.label, "cop-gap") : "";
  const other = g.other.map((o) => btn(o.i, o.label, "")).join("");
  return `<div class="cop">
    <span class="kind flag">${icon("ask", 16)}Coincidence flagged</span>
    <div class="opts">${confirm}${alts}${gap}${other}</div>
  </div>`;
}
