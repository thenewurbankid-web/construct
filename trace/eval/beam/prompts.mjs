// Prompt files of the planner eval (#896): prompts/requester.md, prompts/grader.md and prompts/rubric.md, each with a
// `version:` in its front matter. The current file is the newest version; older versions live in prompts/archive/
// as <role>.<version>.md, so a setup (requester version × grader version) can be re-run and compared later. Every
// judge call records the file, the version and a content hash, so an edit without a version bump is still visible.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const BEAM_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROMPTS_DIR = path.join(BEAM_DIR, "prompts");
export const ROLES = Object.freeze(["requester", "grader", "rubric"]);

/**
 * Split a prompt file into its front matter (`key: value` lines between `---` fences) and its body.
 * @param {string} text
 * @returns {{meta: Record<string, string>, body: string}}
 */
export function parsePromptFile(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]] = kv[2];
  }
  return { meta, body: text.slice(m[0].length) };
}

const sha = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
const readFile = (p) => fs.readFileSync(p, "utf8");

/**
 * Every version of a role's prompt: the current file plus the archive. Newest (current) first.
 * @param {string} role requester | grader | rubric
 * @param {string} [dir]
 * @returns {{version: string, file: string, current: boolean}[]}
 */
export function listVersions(role, dir = PROMPTS_DIR) {
  if (!ROLES.includes(role)) throw new Error(`unknown prompt role "${role}"`);
  const out = [];
  const cur = path.join(dir, `${role}.md`);
  if (fs.existsSync(cur)) out.push({ version: parsePromptFile(readFile(cur)).meta.version ?? "v0", file: cur, current: true });
  const arch = path.join(dir, "archive");
  if (fs.existsSync(arch)) {
    for (const f of fs.readdirSync(arch).sort().reverse()) {
      const m = new RegExp(`^${role}\\.(.+)\\.md$`).exec(f);
      if (m && !out.some((v) => v.version === m[1])) out.push({ version: m[1], file: path.join(arch, f), current: false });
    }
  }
  return out;
}

/**
 * Load one version of a role's prompt (the current one when `version` is omitted).
 * @param {string} role
 * @param {string} [version]
 * @param {string} [dir]
 * @returns {{role: string, version: string, file: string, sha: string, body: string}}
 */
export function loadPrompt(role, version, dir = PROMPTS_DIR) {
  const all = listVersions(role, dir);
  const hit = version ? all.find((v) => v.version === version) : all[0];
  if (!hit) throw new Error(`no ${role} prompt${version ? ` version ${version}` : ""} under ${dir} (have: ${all.map((v) => v.version).join(", ") || "none"})`);
  const text = readFile(hit.file);
  return { role, version: hit.version, file: path.relative(BEAM_DIR, hit.file), sha: sha(text), body: parsePromptFile(text).body };
}

const LINE_HEAD = /^##\s+([a-z][a-z0-9-]*)\s+[—-]\s+(.+?)\s+\(0\s*[–-]\s*(\d)\)\s*$/;

/**
 * The rubric's scored lines, from its `## <id> — <title> (0–<max>)` headings.
 * @param {string} body
 * @returns {{id: string, title: string, max: number}[]}
 */
export function parseRubric(body) {
  const lines = [];
  for (const l of body.split("\n")) {
    const m = LINE_HEAD.exec(l);
    if (m) lines.push({ id: m[1], title: m[2], max: Number(m[3]) });
  }
  if (!lines.length) throw new Error("the rubric has no scored lines (headings like '## intent — Intent right (0–2)')");
  return lines;
}

/**
 * Load a rubric version with its parsed lines.
 * @param {string} [version]
 * @param {string} [dir]
 */
export function loadRubric(version, dir = PROMPTS_DIR) {
  const p = loadPrompt("rubric", version, dir);
  return { ...p, lines: parseRubric(p.body) };
}

/** Fill `{{NAME}}` placeholders; an unknown placeholder is an error (a prompt never ships with a hole). */
export function fillTemplate(body, values) {
  return body.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => {
    if (!(k in values)) throw new Error(`prompt placeholder {{${k}}} has no value`);
    return values[k];
  });
}

/** A setup id from its versions: "r-v1.g-v2". */
export const setupId = (requester, grader) => `r-${requester}.g-${grader}`;

/** Parse a setup id back into its versions, or null. */
export function parseSetupId(id) {
  const m = /^r-([\w-]+)\.g-([\w-]+)$/.exec(String(id));
  return m ? { requester: m[1], grader: m[2] } : null;
}
