// #383 (slice 15 of epic #367/#616) -- the story.md format and its mechanical block: parse `features/<name>/story.md`,
// write only the tool-owned snapshot between markers, assign stable acceptance ids, compare mechanically against code,
// and read `@story` tags from tests. Spec: docs/design/ia-five-screens.md section 9 (revised 2026-09-20).
//
//   parseStory(text)                    pure: front matter (user-owned), tool block (tool-owned) and user text
//   writeStorySnapshot(text, snapshot)  pure: rewrites ONLY the tool block; refuses (conflict) over a hand-edited block
//   assignAcceptanceIds(prior, texts)   pure: S1..Sn, assigned once, never renumbered
//   compareStory(acceptance, refs)      pure: three lists -- missing / undocumented / matched -- no model
//   readStoryTags(text)                 pure: the `@story S1, S2` ids a test file references
//   storyTemplate(featureName)          pure: the file "Add a story" writes as a normal diff
//   ensureStoryNonLayer(root)           fs: declares `nonLayer: features/*/story.md` once (#348 precedent)
//   buildStoryCiteWillSend(...)         pure: the AI-compare disclosure (files/bytes/calls) before it is sent (#388)
//   buildStoryCitePrompt(...)           pure: the citation-only prompt (acceptance + code unit names, nothing else)
//   parseStoryCitations(raw)            pure: a model's response -> candidate citations (never throws)
//   verifyStoryCitations(cites, known)  pure: mechanical verification -- only real ids/units survive (#388)
//
// Fetching (StoryApi.fetch, SSRF, consent, the userscript bridge) is slice 16/18 (#384, #386); the Story tab and
// indicators are slice 17 (#385). AI compare's own model call is made by the caller (ui/server, via
// packages/core/llm.mjs); nothing here calls a model, the network or a clock -- `fetchedAt` and the freshness fields
// arrive from the caller.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import { loadConfig } from './config.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { isNonLayerPath } from './nonLayer.mjs';

/** The glob a project declares as `nonLayer:` so a story.md at a feature root is not an unrecognized file (SOC-001). */
export const STORY_GLOB = 'features/*/story.md';

const TOOL_BEGIN_RE = /<!-- construct:tool-begin ([^\n>]*?) -->\n([\s\S]*?)<!-- construct:tool-end -->\n?/;
const ATTR_RE = /(\w+)=(\S+)/g;
const ACCEPTANCE_LINE_RE = /^- (S\d+) (.*)$/;
const STATUS_LINE_RE = /^Status: (.*)$/;
const ACCEPTANCE_ID_RE = /^S(\d+)$/;

const usage = (message) => new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });
const sha256Hex = (text) => crypto.createHash('sha256').update(text).digest('hex');

/**
 * A copy of `value` with object keys sorted at every depth, so its JSON text is one exact string regardless of build order.
 *
 * @param {any} value A JSON-like value.
 * @returns {any} The canonical copy.
 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

/**
 * The `sourceHash` of a snapshot: a hash of exactly the fields a fetch picked (title, description, status, acceptance
 * text in order), so a re-fetch that picked the same fields hashes the same regardless of `fetchedAt`.
 *
 * @param {{ title?: string, description?: string, status?: string, acceptance?: string[] }} fields The picked fields (acceptance as plain text, ids not included).
 * @returns {string} A sha256 hex digest.
 *
 * @example
 * computeSourceHash({ title: 'Refund', acceptance: ['Shows only when delivered'] }); // => a stable hex string
 */
export function computeSourceHash(fields) {
  const picked = {
    title: fields?.title ?? '',
    description: fields?.description ?? '',
    status: fields?.status ?? '',
    acceptance: Array.isArray(fields?.acceptance) ? fields.acceptance : [],
  };
  return sha256Hex(JSON.stringify(canonicalize(picked)));
}

/** Parse the marker's attribute string (`fetchedAt=... sourceHash=... blockHash=...`) into an object. */
function parseAttrs(raw) {
  const out = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw))) out[m[1]] = m[2];
  return out;
}

/**
 * Render the block's inner content (title, description, status, acceptance) -- the exact bytes `blockHash` covers.
 * @param {{ title?: string, description?: string, status?: string, acceptance?: {id: string, text: string}[] }} fields
 */
function renderBlockContent({ title, description, status, acceptance }) {
  const lines = [`# ${title ?? ''}`];
  if (description) lines.push('', description);
  if (status) lines.push('', `Status: ${status}`);
  if (acceptance?.length) {
    lines.push('');
    for (const { id, text } of acceptance) lines.push(`- ${id} ${text}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Parse the block's inner content back into `{ title, description, status, acceptance }`. */
function parseBlockContent(content) {
  const lines = content.replace(/\n+$/, '').split('\n');
  let title = '';
  const acceptance = [];
  let status = '';
  const descriptionLines = [];
  let i = 0;
  if (lines[0]?.startsWith('# ')) { title = lines[0].slice(2).trim(); i = 1; }
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const acc = ACCEPTANCE_LINE_RE.exec(line);
    if (acc) { acceptance.push({ id: acc[1], text: acc[2] }); continue; }
    const st = STATUS_LINE_RE.exec(line);
    if (st) { status = st[1]; continue; }
    descriptionLines.push(line);
  }
  return { title, description: descriptionLines.join('\n').trim(), status, acceptance };
}

/**
 * Parse a `story.md` file's text into its user-owned front matter, its tool-owned block (or `null` when there is none
 * yet -- mode b, direct content, or a fresh template) and the user text that follows. Never throws on malformed input;
 * a block that cannot be parsed is treated as absent so the caller can still see the file's user text.
 *
 * @param {string} text The full file text.
 * @returns {{ sources: object[], tool: null | { fetchedAt: string, sourceHash: string, blockHash: string, handEdited: boolean, title: string, description: string, status: string, acceptance: {id: string, text: string}[] }, userText: string }}
 *
 * @example
 * parseStory('---\nsources: []\n---\n<!-- construct:tool-begin fetchedAt=x sourceHash=y blockHash=z -->\n# T\n<!-- construct:tool-end -->\n\n## Notes\n').tool.title; // => 'T'
 */
export function parseStory(text) {
  let rest = text ?? '';
  let sources = [];
  const fmMatch = /^---\n([\s\S]*?)\n---\n?/.exec(rest);
  if (fmMatch) {
    rest = rest.slice(fmMatch[0].length);
    try {
      const parsed = yaml.load(fmMatch[1]);
      if (parsed && Array.isArray(parsed.sources)) sources = parsed.sources;
    } catch { /* malformed front matter: sources stays [], the block/user text below is still readable */ }
  }

  const blockMatch = TOOL_BEGIN_RE.exec(rest);
  if (!blockMatch) return { sources, tool: null, userText: rest };

  const attrs = parseAttrs(blockMatch[1]);
  const content = blockMatch[2];
  const recomputedHash = sha256Hex(content);
  const parsedBlock = parseBlockContent(content);
  const userText = rest.slice(blockMatch.index + blockMatch[0].length).replace(/^\n/, '');
  return {
    sources,
    tool: {
      fetchedAt: attrs.fetchedAt ?? '',
      sourceHash: attrs.sourceHash ?? '',
      blockHash: attrs.blockHash ?? '',
      handEdited: !!attrs.blockHash && attrs.blockHash !== recomputedHash,
      ...parsedBlock,
    },
    userText,
  };
}

/**
 * Assign acceptance ids to a new list of texts against the ids a prior snapshot already carried: a text that already
 * has an id keeps it (matched by exact text, first match consumed, so a repeated line does not steal another's id); a
 * new text gets the next unused `S<n>`, counting up from the highest id ever assigned. Ids are never reused or renumbered.
 *
 * @param {{id: string, text: string}[]} prior The previous snapshot's acceptance items (possibly `[]`).
 * @param {string[]} texts The newly fetched acceptance texts, in source order.
 * @returns {{id: string, text: string}[]} The new list, same order as `texts`.
 *
 * @example
 * assignAcceptanceIds([{ id: 'S1', text: 'a' }], ['a', 'b']); // => [{ id: 'S1', text: 'a' }, { id: 'S2', text: 'b' }]
 */
export function assignAcceptanceIds(prior, texts) {
  const available = new Map(); // text -> [ids...]
  for (const { id, text } of prior ?? []) {
    if (!available.has(text)) available.set(text, []);
    available.get(text).push(id);
  }
  let next = 1;
  for (const { id } of prior ?? []) {
    const n = ACCEPTANCE_ID_RE.exec(id)?.[1];
    if (n) next = Math.max(next, Number(n) + 1);
  }
  const out = [];
  for (const text of texts ?? []) {
    const pool = available.get(text);
    const id = pool?.length ? pool.shift() : `S${next++}`;
    out.push({ id, text });
  }
  return out;
}

/**
 * The tool-owned snapshot, and the text `writeStorySnapshot` will place between the markers.
 *
 * @param {{ fetchedAt: string, sourceHash: string, title?: string, description?: string, status?: string, acceptance: {id: string, text: string}[] }} snapshot The fields to write.
 * @returns {string} The full `<!-- construct:tool-begin ... --> ... <!-- construct:tool-end -->` text, ending in a newline.
 */
export function renderToolBlock(snapshot) {
  const content = renderBlockContent(snapshot);
  const blockHash = sha256Hex(content);
  return `<!-- construct:tool-begin fetchedAt=${snapshot.fetchedAt} sourceHash=${snapshot.sourceHash} blockHash=${blockHash} -->\n${content}<!-- construct:tool-end -->\n`;
}

/**
 * Rewrite a `story.md`'s tool block with a freshly fetched snapshot -- the ONLY function that changes the file, and it
 * only ever touches the bytes between the markers: front matter and user text are carried through byte-for-byte.
 * Refuses (a conflict, nothing written) when the existing tool block was hand-edited (its hash no longer matches
 * `blockHash`) so a hand edit is never silently overwritten. Rewrites only when the picked fields actually changed
 * (`sourceHash` differs), so "checked every time, written only if it changed" holds without a caller needing to diff.
 *
 * @param {string} existingText The file's current full text (`''` for a brand-new file).
 * @param {{ fetchedAt: string, title?: string, description?: string, status?: string, acceptanceTexts: string[] }} fetched What was just fetched.
 * @returns {{ conflict: true } | { conflict: false, changed: boolean, text: string, acceptance: {id: string, text: string}[] }}
 *
 * @example
 * writeStorySnapshot('', { fetchedAt: '2026-09-20T12:00:00Z', title: 'Refund', acceptanceTexts: ['Shows when delivered'] }).changed; // => true
 */
export function writeStorySnapshot(existingText, fetched) {
  const parsed = parseStory(existingText ?? '');
  if (parsed.tool?.handEdited) return { conflict: true };

  const prior = parsed.tool?.acceptance ?? [];
  const acceptance = assignAcceptanceIds(prior, fetched.acceptanceTexts ?? []);
  const sourceHash = computeSourceHash({ title: fetched.title, description: fetched.description, status: fetched.status, acceptance: fetched.acceptanceTexts ?? [] });

  if (parsed.tool && parsed.tool.sourceHash === sourceHash) {
    return { conflict: false, changed: false, text: existingText, acceptance: prior };
  }

  const block = renderToolBlock({ fetchedAt: fetched.fetchedAt, sourceHash, title: fetched.title ?? '', description: fetched.description ?? '', status: fetched.status ?? '', acceptance });
  const frontMatterMatch = /^---\n[\s\S]*?\n---\n?/.exec(existingText ?? '');
  const frontMatter = frontMatterMatch ? frontMatterMatch[0] : '';
  const userText = parsed.userText ?? '';
  const text = `${frontMatter}${block}${userText ? `\n${userText}` : ''}`;
  return { conflict: false, changed: true, text, acceptance };
}

/**
 * Compare a story's acceptance ids against the ids the code actually references (from `readStoryTags`), as three
 * lists and nothing else -- no model, no fuzzy matching.
 *
 * @param {{id: string}[]} acceptance The story's acceptance items.
 * @param {Iterable<string>} referencedIds Ids referenced by `@story` tags across the feature's tests/scenarios.
 * @returns {{ missing: string[], undocumented: string[], matched: string[] }} Missing from the code, in the code but not in the story, and matched -- each sorted, ids only.
 *
 * @example
 * compareStory([{ id: 'S1' }, { id: 'S2' }], ['S1', 'S3']); // => { missing: ['S2'], undocumented: ['S3'], matched: ['S1'] }
 */
export function compareStory(acceptance, referencedIds) {
  const storyIds = new Set((acceptance ?? []).map((a) => a.id));
  const refIds = new Set(referencedIds ?? []);
  const missing = [...storyIds].filter((id) => !refIds.has(id)).sort();
  const undocumented = [...refIds].filter((id) => !storyIds.has(id)).sort();
  const matched = [...storyIds].filter((id) => refIds.has(id)).sort();
  return { missing, undocumented, matched };
}

/**
 * A stable hash of a compare summary, so the Story indicator can tell "the same drift as last time" from "something
 * changed" without re-running the compare (9.5: "a hash of the generated summary drives may be out of date / mark reviewed").
 *
 * @param {{ missing: string[], undocumented: string[], matched: string[] }} summary A `compareStory` result.
 * @returns {string} A sha256 hex digest.
 */
export function summaryDriftHash(summary) {
  return sha256Hex(JSON.stringify(canonicalize({ missing: summary.missing, undocumented: summary.undocumented, matched: summary.matched })));
}

const STORY_TAG_RE = /@story\s+([A-Za-z0-9,\s]+)/g;
const STORY_ID_RE = /S\d+/g;

/**
 * The acceptance ids a test/scenario file references via `@story S1, S2` tags in its comments, in first-seen order.
 *
 * @param {string} text A test file's source text.
 * @returns {string[]} The referenced ids, deduplicated, in the order they first appear.
 *
 * @example
 * readStoryTags('// @story S1, S3\nit(...)'); // => ['S1', 'S3']
 */
export function readStoryTags(text) {
  const seen = new Set();
  const out = [];
  let m;
  STORY_TAG_RE.lastIndex = 0;
  while ((m = STORY_TAG_RE.exec(text ?? ''))) {
    let idm;
    STORY_ID_RE.lastIndex = 0;
    while ((idm = STORY_ID_RE.exec(m[1]))) {
      if (!seen.has(idm[0])) { seen.add(idm[0]); out.push(idm[0]); }
    }
  }
  return out;
}

/**
 * The file "Add a story" writes as a normal diff: an empty front matter (no source configured yet), a tool block with
 * only a title (the feature name) and no acceptance, and a `## Acceptance notes` heading for the user to write under.
 *
 * @param {string} featureName The feature the story belongs to.
 * @returns {string} The full `story.md` text.
 *
 * @example
 * storyTemplate('cart').includes('# cart'); // => true
 */
export function storyTemplate(featureName) {
  const block = renderToolBlock({ fetchedAt: '', sourceHash: computeSourceHash({ title: featureName, acceptance: [] }), title: featureName, description: '', status: '', acceptance: [] });
  return `---\nsources: []\n---\n${block}\n## Acceptance notes\n`;
}

/**
 * What the AI-compare disclosure (design 9.5/9.6, "the control shows exactly what is sent ... and the number of
 * model calls") reports before the call is made -- computed from the acceptance items and code units alone, so the
 * inline Generate control's `willSend` never has to guess. One call, one file (the constructed prompt).
 *
 * @param {{id: string, text: string}[]} acceptance The story's acceptance items.
 * @param {string[]} codeUnits The candidate code units (scenario/route/test names) the AI may cite.
 * @returns {{ files: number, bytes: number, calls: number }}
 *
 * @example
 * buildStoryCiteWillSend([{ id: 'S1', text: 'a' }], ['Happy path']).calls; // => 1
 */
export function buildStoryCiteWillSend(acceptance, codeUnits) {
  const prompt = buildStoryCitePrompt(acceptance, codeUnits);
  return { files: 1, bytes: Buffer.byteLength(prompt, 'utf8'), calls: 1 };
}

/**
 * The prompt sent for AI compare (design 9.5): the model may only see the acceptance lines and the code unit
 * names -- never file contents, never the whole story -- and is asked to cite which code unit(s) satisfy which
 * acceptance id, so every claim it makes is checkable mechanically afterwards.
 *
 * @param {{id: string, text: string}[]} acceptance The story's acceptance items.
 * @param {string[]} codeUnits The candidate code units (scenario/route/test names) the AI may cite.
 * @returns {string} The prompt text.
 */
export function buildStoryCitePrompt(acceptance, codeUnits) {
  const lines = [
    'Match each acceptance line to the code unit(s) that implement it, if any. Cite ONLY the ids and code unit',
    'names given below -- do not invent an id or a code unit name that is not listed. Reply with ONLY a JSON array,',
    'no prose, each item shaped exactly as {"acceptanceId": "<id>", "codeUnit": "<name>", "note": "<short reason>"}.',
    '',
    'Acceptance:',
    ...(acceptance ?? []).map((a) => `- ${a.id} ${a.text}`),
    '',
    'Code units:',
    ...(codeUnits ?? []).map((u) => `- ${u}`),
  ];
  return lines.join('\n');
}

/**
 * Parse a model's citation response into a plain array, tolerant of a fenced code block or surrounding prose. Never
 * throws: anything that is not a parseable JSON array of plain objects yields `[]`, since a malformed response is
 * exactly what mechanical verification exists to catch (nothing here is trusted yet).
 *
 * @param {string} raw The model's raw response text.
 * @returns {{ acceptanceId: any, codeUnit: any, note: any }[]} Unverified candidate citations (may contain wrong types).
 *
 * @example
 * parseStoryCitations('[{"acceptanceId":"S1","codeUnit":"Happy path"}]'); // => [{ acceptanceId: 'S1', codeUnit: 'Happy path' }]
 */
export function parseStoryCitations(raw) {
  const text = stripCodeFence(String(raw ?? ''));
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed.filter((c) => c && typeof c === 'object' && !Array.isArray(c)) : [];
  } catch {
    return [];
  }
}

/** A best-effort strip of one leading/trailing ```-fenced block, mirroring `stripCodeFence` in `llm.mjs` (kept local
 * so this module has no dependency on the LLM caller -- it only ever parses text handed to it). */
function stripCodeFence(text) {
  const trimmed = text.trim();
  const m = trimmed.match(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$/);
  return m ? m[1] : trimmed;
}

/**
 * Mechanical verification of AI-proposed citations (design 9.5: "it may only cite acceptance lines and code units,
 * and every citation is verified mechanically before it is shown"). A citation survives only if its `acceptanceId`
 * and `codeUnit` are both EXACTLY one of the real ids/units given -- no fuzzy matching, no partial credit. Nothing
 * here calls a model: this is the check that runs on whatever the model said, after the fact.
 *
 * @param {{acceptanceId: any, codeUnit: any, note?: any}[]} citations Candidate citations (e.g. from `parseStoryCitations`).
 * @param {{acceptanceIds?: Iterable<string>, codeUnitIds?: Iterable<string>}} [known] The real ids and code units a citation may reference.
 * @returns {{ verified: {acceptanceId: string, codeUnit: string, note: string}[], dropped: {citation: any, reason: string}[] }}
 *
 * @example
 * verifyStoryCitations([{ acceptanceId: 'S1', codeUnit: 'Happy path' }, { acceptanceId: 'S9', codeUnit: 'Happy path' }],
 *   { acceptanceIds: ['S1'], codeUnitIds: ['Happy path'] });
 * // => { verified: [{ acceptanceId: 'S1', codeUnit: 'Happy path', note: '' }], dropped: [{ citation: {...}, reason: 'unknown acceptance id' }] }
 */
export function verifyStoryCitations(citations, { acceptanceIds, codeUnitIds } = {}) {
  const knownAcceptance = new Set(acceptanceIds ?? []);
  const knownUnits = new Set(codeUnitIds ?? []);
  const verified = [];
  const dropped = [];
  for (const citation of citations ?? []) {
    const acceptanceId = citation?.acceptanceId;
    const codeUnit = citation?.codeUnit;
    if (typeof acceptanceId !== 'string' || typeof codeUnit !== 'string') { dropped.push({ citation, reason: 'not a citation (missing acceptanceId or codeUnit)' }); continue; }
    if (!knownAcceptance.has(acceptanceId)) { dropped.push({ citation, reason: `unknown acceptance id "${acceptanceId}"` }); continue; }
    if (!knownUnits.has(codeUnit)) { dropped.push({ citation, reason: `unknown code unit "${codeUnit}"` }); continue; }
    verified.push({ acceptanceId, codeUnit, note: typeof citation.note === 'string' ? citation.note : '' });
  }
  return { verified, dropped };
}

/**
 * Declare `nonLayer: [features/*​/story.md]` in `architecture.yml` once, so a `story.md` at a feature root is not an
 * unrecognized file (SOC-001, #348 precedent). Returns `false` when it is already covered. Refuses (nothing written)
 * when `nonLayer:` already exists but does not cover the glob -- the same half-declared refusal `ensureTestRegions` uses.
 *
 * @param {string} root Project root.
 * @returns {boolean} Whether the glob was added.
 * @throws {Error} A usage error when there is no architecture.yml, or `nonLayer:` exists without the glob.
 */
export function ensureStoryNonLayer(root) {
  const config = loadConfig(root);
  const probe = path.join(root, 'features', '__story_probe__', 'story.md');
  if (isNonLayerPath(root, probe, config.nonLayer || [])) return false;
  const file = path.join(root, 'architecture.yml');
  if (!fs.existsSync(file)) throw usage('There is no architecture.yml here: this is not a Construct project (run `construct init`).');
  const text = fs.readFileSync(file, 'utf8');
  if (/^nonLayer:/m.test(text)) {
    throw usage(`architecture.yml already has nonLayer: but not "${STORY_GLOB}". Add it by hand, then run this again. Nothing was written.`);
  }
  fs.writeFileSync(file, `${text.replace(/\n*$/, '\n')}\nnonLayer:\n  - ${STORY_GLOB}\n`);
  return true;
}
