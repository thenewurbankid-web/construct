// T27.3: a deterministic notification for a drift report — an email draft (same "fixed text, not model-written"
// rule as the run summary's email composer, src/ai/mail-chat.mjs and README's "Run summary") and/or a written
// report file. This module never sends anything: it only builds the content. Recipients (BE/FE contacts) are
// never guessed — nothing in this codebase records who owns a feature's backend or frontend (checked: no
// "owner"/"team" field on feature.json), so `to`/`cc` are the caller's own input; with none given, the draft
// still uses generic role labels ("Backend team", "Frontend team") in its body, never invented names or emails.
import fs from "node:fs";
import path from "node:path";

// Why each kind of drift matters, and who it is addressed to — a fixed rule, not a guess per instance.
const AUDIENCE = {
  added: { who: "Frontend", why: "A new endpoint is available; nothing breaks, but the frontend may want to use it." },
  removed: { who: "Backend and Frontend", why: "An endpoint the frontend may call no longer exists in the backend's contract." },
  "param-renamed": { who: "Backend and Frontend", why: "A path parameter was renamed; any call built from the old path will 404." },
  "request-changed": { who: "Backend and Frontend", why: "The request shape changed; a request built from the old shape may be rejected or misread." },
  "response-changed": { who: "Backend and Frontend", why: "The response shape changed; frontend code reading the old shape may break or silently drop fields." },
};

const lineOf = (e) => {
  if (e.kind === "param-renamed") return `  - ${e.method} ${e.before} -> ${e.after} (path parameter renamed)`;
  if (e.kind) return `  - ${e.method} ${e.path}: ${e.before} -> ${e.after}`;
  return `  - ${e.method} ${e.path}`;
};

/**
 * Build the drift notification's content: a subject and body listing what drifted, why it matters, and who it
 * affects. Deterministic (same report/decision/meta always give the same text); no model.
 *
 * @param {{added:Array, removed:Array, changed:Array, hasDrift:boolean}} report From `diffContracts`.
 * @param {{status:string, blocked:boolean, reason:string|null}} decision From `decideDrift`.
 * @param {{feature?: string, contractFile?: string, to?: string[], cc?: string[]}} [meta]
 * @returns {{subject:string, to:string[], cc:string[], body:string}}
 */
export function buildDriftNotification(report, decision, { feature = null, contractFile = null, to = [], cc = [] } = {}) {
  const featureLabel = feature ? ` for "${feature}"` : "";
  const subject = report.hasDrift
    ? `Contract drift detected${featureLabel}: ${report.added.length + report.removed.length + report.changed.length} change${report.added.length + report.removed.length + report.changed.length === 1 ? "" : "s"}`
    : `No contract drift${featureLabel}`;

  const lines = [];
  lines.push(report.hasDrift
    ? `The backend's contract${featureLabel} has drifted from the one Trace has on file${contractFile ? ` (${contractFile})` : ""}.`
    : `The backend's contract${featureLabel} matches the one Trace has on file${contractFile ? ` (${contractFile})` : ""}. No drift found.`);
  lines.push("");

  const sections = [
    ["Removed endpoints", report.removed],
    ["Added endpoints", report.added],
    ["Changed", report.changed],
  ];
  const audiences = new Set();
  for (const [title, entries] of sections) {
    if (!entries.length) continue;
    lines.push(`${title}:`);
    for (const e of entries) {
      lines.push(lineOf(e));
      const a = AUDIENCE[e.kind ?? (title === "Removed endpoints" ? "removed" : "added")];
      if (a) audiences.add(a.who);
    }
    lines.push("");
  }

  if (report.hasDrift) {
    lines.push("Why it matters:");
    for (const [kind, a] of Object.entries(AUDIENCE)) {
      const has = (kind === "added" && report.added.length > 0) || (kind === "removed" && report.removed.length > 0) || report.changed.some((e) => e.kind === kind);
      if (has) lines.push(`  - ${a.who}: ${a.why}`);
    }
    lines.push("");
  }

  if (decision?.blocked) {
    lines.push(`This run was blocked: ${decision.reason}`);
    lines.push("");
  }

  lines.push(`Affected: ${[...audiences].sort().join(", ") || "no one (no drift)"}.`);

  return { subject, to, cc, body: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n" };
}

/**
 * Write the notification as a plain-text report file (the "written report file" alternative to an email draft).
 * Same temp-file-then-rename pattern as `storeDrift`, so a reader never sees a half-written file. Creates `dir`
 * (and any missing parent directories) first, so a caller does not need to pre-create the output directory.
 *
 * @param {string} dir
 * @param {{subject:string, to:string[], cc:string[], body:string}} notification From `buildDriftNotification`.
 * @param {{file?: string}} [opts]
 * @returns {string} The path written.
 */
export function writeDriftReport(dir, notification, { file = "drift-notification.txt" } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, file);
  const tmp = path.join(dir, `.${file}.${process.pid}.tmp`);
  const header = [`Subject: ${notification.subject}`, `To: ${notification.to.join(", ") || "(unassigned)"}`, notification.cc.length ? `Cc: ${notification.cc.join(", ")}` : null].filter(Boolean).join("\n");
  fs.writeFileSync(tmp, `${header}\n\n${notification.body}`);
  fs.renameSync(tmp, out);
  return out;
}
