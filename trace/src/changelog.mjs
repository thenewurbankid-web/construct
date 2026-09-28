// CHANGELOG.md -> structured JSON, for the About page and for build-info's release id.
//
// Format (see the comment at the top of CHANGELOG.md): one `## <id> — <date>` section per release, newest first, then
// bullets `- feat|fix|change|note: text`. A release may hold minor releases: `### R0.1 — <date>` sub-sections (newest
// first) whose bullets belong to the minor, not to the release. This parser never throws: a line it cannot place is
// counted in `ignored` (per section, or at the top level before the first heading) so a hand-edited file still renders.

export const KINDS = ["feat", "fix", "change", "note"];

// `## R0 — 2026-09-27`, `## Unreleased — pre-R0`, `## R1 - 2026-10-01`; the dash may be an em dash, en dash or hyphen.
const HEADING = /^##\s+(.+?)\s*$/;
const DASH = /\s+[—–-]\s+/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BULLET = /^[-*]\s+(.*)$/;
const KIND = /^(feat|fix|change|note)\s*:\s*(.*)$/i;
const MINOR_HEADING = /^###(?!#)\s*(.*?)\s*$/; // a bare `###` is a minor with no id, so the bullets under it are not taken for the release's
const RELEASE_ID = /^R(\d+)(?:\.(\d+))?$/i;

// "R0" -> { major: 0, minor: null }, "R0.2" -> { major: 0, minor: 2 }; anything else (a hand-written label, `__proto__`,
// `constructor`, "R1.2.3", "R", a number too large to be exact) -> null. Only R<digits> or R<digits>.<digits> is a release id.
/**
 * Parse a release heading id into its major/minor numbers.
 *
 * @param {string} id A heading id, e.g. `"R0"`, `"R0.2"`, `"r1"`.
 * @returns {{major: number, minor: number|null}|null} The parsed id, or `null` when `id` is not
 *   `R<digits>` or `R<digits>.<digits>` (a hand-written label, `__proto__`, `constructor`, `"R1.2.3"`, `"R"`,
 *   or a number too large to be an exact integer).
 */
export function parseReleaseId(id) {
  const m = typeof id === "string" ? id.trim().match(RELEASE_ID) : null;
  if (!m) return null;
  const major = Number(m[1]), minor = m[2] === undefined ? null : Number(m[2]);
  return Number.isSafeInteger(major) && (minor === null || Number.isSafeInteger(minor)) ? { major, minor } : null;
}

// The major id and the minor id of a release id: "R0.1" -> { major: "R0", minor: "R0.1" }, "R0" -> { major: "R0", minor: null },
// an id that is not R<n>[.<m>] -> both null (never guessed).
/**
 * Split a release id into its major heading id and minor heading id.
 *
 * @param {string} id A release or minor-release id, e.g. `"R0.1"`, `"R0"`.
 * @returns {{major: string|null, minor: string|null}} `"R0.1"` -> `{major: "R0", minor: "R0.1"}`, `"R0"` ->
 *   `{major: "R0", minor: null}`; both `null` when `id` is not `R<n>[.<m>]` (never guessed).
 */
export function splitReleaseId(id) {
  const p = parseReleaseId(id);
  return p ? { major: `R${p.major}`, minor: p.minor === null ? null : `R${p.major}.${p.minor}` } : { major: null, minor: null };
}

// Sort order: R0 < R0.1 < R0.2 < R1 < R1.1 < R10. An id that is not R<n>[.<m>] sorts before every real one, then by text.
/**
 * Compare two release ids for sorting: `R0 < R0.1 < R0.2 < R1 < R1.1 < R10`. An id that is not `R<n>[.<m>]` sorts
 * before every real one, then by plain text comparison.
 *
 * @param {string} a A release id.
 * @param {string} b Another release id.
 * @returns {number} Negative if `a` sorts before `b`, positive if after, `0` if equal.
 */
export function compareReleaseIds(a, b) {
  const x = parseReleaseId(a), y = parseReleaseId(b);
  if (!x || !y) return x ? 1 : y ? -1 : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  return x.major - y.major || (x.minor ?? -1) - (y.minor ?? -1);
}

/**
 * Parse `CHANGELOG.md` text into structured releases. Never throws: a line that cannot be placed is counted in
 * `ignored` (per section, or at the top level before the first heading) instead, so a hand-edited file still
 * renders.
 *
 * @param {string} text The changelog's Markdown text.
 * @returns {{releases: {id: string, date: string|null, label: string|null, unreleased: boolean,
 *   items: {kind: string, text: string}[], minors: object[], ignored: number}[], ignored: number}}
 *   The releases (newest first, as written), each with its bullet items and any `### <id>` minors, plus the
 *   total count of lines that could not be placed.
 */
export function parseChangelog(text) {
  const src = String(text ?? "").replace(/<!--[\s\S]*?-->/g, ""); // the convention comment at the top is not content
  const releases = [];
  let ignored = 0, cur = null, sect = null, last = null; // sect: where bullets go (cur, or one of cur.minors); last: the item an indented line may continue
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const h = line.match(HEADING);
    if (h) {
      const [id, ...rest] = h[1].split(DASH).map((s) => s.trim());
      const tail = rest.join(" — ");
      cur = {
        id: id || "(untitled)",
        date: DATE.test(tail) ? tail : null,
        label: tail && !DATE.test(tail) ? tail : null,
        unreleased: /^unreleased$/i.test(id),
        items: [],
        minors: [],
        ignored: 0,
      };
      releases.push(cur);
      sect = cur;
      last = null;
      continue;
    }
    const mh = line.match(MINOR_HEADING);
    if (mh) {
      last = null;
      if (!cur) { ignored++; continue; } // a minor with no release above it
      const [id, ...rest] = mh[1].split(DASH).map((s) => s.trim());
      const tail = rest.join(" — ");
      if (!id) ignored++; // no id: kept as "(untitled)" so its bullets stay together, but counted as unreadable
      sect = { id: id || "(untitled)", date: DATE.test(tail) ? tail : null, label: tail && !DATE.test(tail) ? tail : null, items: [], ignored: 0 };
      cur.minors.push(sect);
      continue;
    }
    if (/^#\s/.test(line)) continue; // the file title
    const b = line.trim().match(BULLET);
    if (b && /^\S/.test(line)) {
      last = null;
      if (!sect) { ignored++; continue; }
      const k = b[1].match(KIND);
      const item = k ? { kind: k[1].toLowerCase(), text: k[2].trim() } : { kind: "note", text: b[1].trim() };
      if (item.text) { sect.items.push(item); last = item; } else sect.ignored++;
      continue;
    }
    // an indented line right after a bullet continues it; anything else is noise we count but do not show
    if (last && /^\s+\S/.test(line)) last.text += " " + line.trim();
    else if (sect) { last = null; sect.ignored++; }
    else ignored++;
  }
  const inSection = (r) => r.ignored + r.minors.reduce((n, m) => n + m.ignored, 0);
  return { releases, ignored: ignored + releases.reduce((n, r) => n + inSection(r), 0) };
}

// The newest real release id (skips "Unreleased" and any heading that is not R<digits>[.<digits>]: a junk id such as
// `__proto__`, `constructor` or "beta" is never the answer); null when there is none. The first valid release in the file
// (newest first) wins. When it has minors the newest of them is the answer (`R0.1`, not `R0`): the highest by
// compareReleaseIds, so the order in the file does not matter. Only a valid minor of THAT release counts (`R1.2` under
// `## R1`; an `R2.1` heading under `## R1`, or a bare `R1`, is ignored). The result is the canonical form (`r1` -> `R1`).
/**
 * The newest real release id from a parsed changelog: skips "Unreleased" and any heading that is not
 * `R<digits>[.<digits>]` (a junk id such as `__proto__`, `constructor` or `"beta"` is never the answer). The
 * first valid release in the file (newest first) wins; when it has minors, the highest by
 * {@link compareReleaseIds} is returned (e.g. `"R0.1"`, not `"R0"`) — only a valid minor of that same release
 * counts. The result is in canonical form (`"r1"` -> `"R1"`).
 *
 * @param {{releases: object[]}|null|undefined} parsed The result of {@link parseChangelog}.
 * @returns {string|null} The newest release id, or `null` when there is none.
 */
export function newestReleaseId(parsed) {
  for (const r of parsed?.releases ?? []) {
    if (r.unreleased) continue;
    const p = parseReleaseId(r.id);
    if (!p) continue;
    let best = p;
    for (const m of r.minors ?? []) {
      const q = parseReleaseId(m.id);
      if (q && q.major === p.major && q.minor !== null && q.minor > (best.minor ?? -1)) best = q;
    }
    return `R${best.major}${best.minor === null ? "" : `.${best.minor}`}`;
  }
  return null;
}
