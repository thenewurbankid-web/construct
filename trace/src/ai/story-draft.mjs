// LIN-105 / TR-10: a PROPOSED page story from one example's design and API contract — a draft only. It never
// writes story.md itself; loadStory (src/ai/context.mjs) is untouched and keeps reading whatever is on disk.
// This follows the exact same shape as T12.1's sample proposal (src/ai/sample.mjs): a small, single-turn,
// CHECKED task. The model writes a user-story `goal` sentence and 2-5 `criteria` bullets; every criterion is
// checked against the example's REAL part and field names (from extractParts/designLabels/loadContract) and
// dropped if it names none of them. Per CLAUDE.md's Qwen policy ("a use needs a verifier ... or it stays off
// or only proposes"), a use that only proposes needs no accuracy measurement — like generate-sample, this one
// never picks or decides anything on its own (a person reviews and saves the draft, or discards it), so it
// carries none, and this file does not add an eval variant.
import path from "node:path";
import fs from "node:fs";
import { extractParts } from "../import/extract-parts.mjs";
import { designLabels } from "../labels.mjs";
import { readSpec } from "../contract.mjs";

const SYSTEM = "You write a short user story for a web page, for review by a person before it is saved. Reply with JSON only: " +
  '{"goal": "<one sentence, \\"As a ..., I want ..., so that ...\\">", "criteria": ["<bullet>", ...]}. ' +
  "Write 2 to 5 criteria. EVERY criterion MUST name at least one of the given part or field names, exactly as given " +
  "(the words are checked afterwards, and a criterion naming none of them is dropped). Do not invent parts or fields that are not listed.";

/**
 * Build the user prompt: the page's name/route, the real part names (with a label when one is known), and the
 * real endpoints and field names from the contract.
 *
 * @param {{feature: string, route: string, parts: {values: object[], lists: object[], actions: object[]},
 *   labels: {values: object, fields: object, list: object}, endpoints: {method: string, path: string}[],
 *   fields: string[]}} req
 * @returns {string}
 */
export function storyPrompt({ feature, route, parts, labels, endpoints, fields }) {
  const partLine = (name, label) => (label ? `${name} ("${label}")` : name);
  const values = (parts.values ?? []).map((v) => partLine(v.name, labels.values?.[v.name]?.label || labels.values?.[v.name]?.inline));
  const listFields = (parts.lists?.[0]?.fields ?? []).map((name) => partLine(name, labels.fields?.[name]?.header || labels.fields?.[name]?.label));
  const actions = (parts.actions ?? []).map((a) => a.name);
  const eps = (endpoints ?? []).map((e) => `${e.method} ${e.path}`);
  return `Page: "${feature}" at ${route}\n` +
    `Values on the page: ${values.length ? values.join(", ") : "(none)"}\n` +
    `List "${parts.lists?.[0]?.name ?? ""}" fields: ${listFields.length ? listFields.join(", ") : "(none)"}\n` +
    `Actions: ${actions.length ? actions.join(", ") : "(none)"}\n` +
    `Endpoints: ${eps.length ? eps.join(", ") : "(none)"}\n` +
    `Contract fields: ${fields.length ? fields.join(", ") : "(none)"}\n` +
    `Reply: {"goal": "<one user-story sentence>", "criteria": ["<bullet naming a real part/field>", ...]}`;
}

/**
 * Verify a raw model reply: valid JSON holding `{"goal": string, "criteria": [string, ...]}`. Any criterion
 * that does not contain (case-insensitive substring) at least one of `partNames`/`fieldNames` is dropped; the
 * goal is kept as-is (it describes the whole page by construction, same reasoning as the story items in
 * src/ai/index.mjs's createAi — see `storyCount`'s comment there). Fails only when nothing usable survives.
 *
 * @param {string} text The model's raw reply.
 * @param {{partNames: string[], fieldNames: string[]}} names The real names to check criteria against.
 * @returns {{ok: true, goal: string, criteria: string[], dropped: string[]}|{ok: false, why: string}}
 */
export function checkStoryDraft(text, { partNames = [], fieldNames = [] } = {}) {
  let parsed;
  try { parsed = JSON.parse(String(text ?? "").match(/\{[\s\S]*\}/)?.[0] ?? ""); } catch { return { ok: false, why: "the reply was not valid JSON" }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, why: "the reply was not a JSON object" };
  const goal = typeof parsed.goal === "string" ? parsed.goal.trim() : "";
  const rawCriteria = Array.isArray(parsed.criteria) ? parsed.criteria.filter((c) => typeof c === "string" && c.trim()) : [];
  const names = [...partNames, ...fieldNames].filter(Boolean);
  const criteria = [];
  const dropped = [];
  for (const c of rawCriteria) {
    const t = c.trim();
    const lower = t.toLowerCase();
    if (names.some((n) => lower.includes(n.toLowerCase()))) criteria.push(t);
    else dropped.push(`"${t}" (names no real part or field)`);
  }
  if (!goal && !criteria.length) return { ok: false, why: "no goal and no criterion named a real part or field" };
  return { ok: true, goal, criteria, dropped };
}

/**
 * Propose one PROPOSED page story: gathers the example's real parts, labels, endpoints and fields, builds the
 * prompt, calls `providerFn`, checks the reply, and formats the accepted goal/criteria into the exact
 * `## Goal` / `## Acceptance criteria` markdown that loadStory (src/ai/context.mjs) parses. Never writes any
 * file — the caller decides whether to save it as story.md.
 *
 * @param {{dir: string, spec?: object, source?: string}} req `spec` is readSpec(dir)'s shape (uses
 *   `spec.contract.apis`/`spec.contract.fieldDocs`); `source` is the page's JSX/TSX text. Either is read from
 *   `dir` when omitted.
 * @param {(args: {system: string, user: string, schema: object, maxTokens: number}) => Promise<{text: string}>} providerFn
 * @returns {Promise<{ok: true, goal: string, criteria: string[], markdown: string, dropped: string[]}|{ok: false, why: string}>}
 */
export async function draftStory({ dir, spec, source }, providerFn) {
  const s = spec ?? readSpec(dir);
  const src = source ?? fs.readFileSync(path.join(dir, s.page || "page.jsx"), "utf8");
  const parts = extractParts(src);
  const labels = designLabels(src);
  const endpoints = s.contract?.apis ?? [];
  const fields = Object.keys(s.contract?.fieldDocs ?? {});
  const user = storyPrompt({ feature: s.feature, route: s.route, parts, labels, endpoints, fields });
  const schema = { type: "object", properties: { goal: { type: "string" }, criteria: { type: "array", items: { type: "string" } } }, required: ["goal", "criteria"] };
  let reply;
  try { reply = await providerFn({ system: SYSTEM, user, schema, maxTokens: 300 }); } catch (e) { return { ok: false, why: `the model call failed: ${e.message}` }; }
  const partNames = [...(parts.values ?? []).map((v) => v.name), ...(parts.lists?.[0]?.fields ?? []), ...(parts.actions ?? []).map((a) => a.name)];
  const fieldNames = fields;
  const checked = checkStoryDraft(reply?.text, { partNames, fieldNames });
  if (!checked.ok) return checked;
  const markdown = `## Goal\n${checked.goal}\n\n## Acceptance criteria\n${checked.criteria.map((c) => `- ${c}`).join("\n")}\n`;
  return { ok: true, goal: checked.goal, criteria: checked.criteria, markdown, dropped: checked.dropped };
}
