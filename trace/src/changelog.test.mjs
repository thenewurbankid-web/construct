import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseChangelog, newestReleaseId, parseReleaseId, splitReleaseId, compareReleaseIds } from "./changelog.mjs";

const OK = `# Changelog

<!-- convention comment
## R99 — 1999-01-01
- feat: must not be parsed
-->

## Unreleased — before R1

- feat: a \`thing\`
- fix: a bug

## R0 — 2026-09-27

- feat: first
- change: second
- note: third
`;

test("parses releases newest first with kinds, dates and labels; skips comments", () => {
  const p = parseChangelog(OK);
  assert.deepEqual(p.releases.map((r) => r.id), ["Unreleased", "R0"]);
  assert.equal(p.releases[0].unreleased, true);
  assert.equal(p.releases[0].label, "before R1");
  assert.equal(p.releases[0].date, null);
  assert.equal(p.releases[1].date, "2026-09-27");
  assert.deepEqual(p.releases[1].items.map((i) => i.kind), ["feat", "change", "note"]);
  assert.deepEqual(p.releases.map((r) => r.minors), [[], []]);
  assert.equal(p.releases[0].items[0].text, "a `thing`");
  assert.equal(p.ignored, 0);
});

test("keeps the file's order of releases and of items", () => {
  const p = parseChangelog("## B — 2026-02-01\n- fix: b2\n- feat: b1\n## A — 2026-01-01\n- note: a\n");
  assert.deepEqual(p.releases.map((r) => r.id), ["B", "A"]);
  assert.deepEqual(p.releases[0].items.map((i) => i.text), ["b2", "b1"]);
});

test("tolerates malformed input without throwing", () => {
  const p = parseChangelog("stray line\n- feat: before any heading\n## R1 - 2026-03-03\n- shout: unknown kind\n- feat:\nrandom prose\n  continued text\n- FIX: upper case\n##\n");
  assert.equal(p.releases[0].id, "R1"); // a hyphen works as the dash
  assert.equal(p.releases[0].date, "2026-03-03");
  assert.deepEqual(p.releases[0].items, [
    { kind: "note", text: "shout: unknown kind" }, // unknown kind: kept as a note
    { kind: "fix", text: "upper case" },
  ]);
  assert.equal(p.releases.length, 1); // the bare `##` is not a heading
  assert.equal(p.ignored, 6); // stray line, bullet before a heading, empty bullet, prose, its orphan continuation, bare ##
});

test("an indented line continues the bullet above it", () => {
  const p = parseChangelog("## R1 — 2026-01-01\n- feat: long\n  more words\n");
  assert.equal(p.releases[0].items[0].text, "long more words");
});

test("empty or non-string input gives no releases", () => {
  for (const v of ["", null, undefined, "   \n\n"]) assert.deepEqual(parseChangelog(v), { releases: [], ignored: 0 });
});

test("newestReleaseId skips Unreleased and returns null without a release", () => {
  assert.equal(newestReleaseId(parseChangelog(OK)), "R0");
  assert.equal(newestReleaseId(parseChangelog("## Unreleased\n- feat: x")), null);
  assert.equal(newestReleaseId(parseChangelog("")), null);
});

test("the repository's own CHANGELOG.md parses cleanly and has an Unreleased section", () => {
  const p = parseChangelog(fs.readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"));
  assert.equal(p.ignored, 0);
  assert.ok(p.releases.length >= 1 && p.releases[0].items.length > 0);
});

const NESTED = `## R1 — 2026-10-01

- feat: release level
### R1.2 — 2026-10-03
- fix: newest minor
  with a continuation
### R1.1 — 2026-10-02
- change: older minor
- note: another

## R0 — 2026-09-27
- feat: first
### R0.1 — 2026-09-27
- fix: cleanup
`;

test("minor sub-entries nest under their release with their own items", () => {
  const p = parseChangelog(NESTED);
  assert.deepEqual(p.releases.map((r) => r.id), ["R1", "R0"]);
  assert.deepEqual(p.releases[0].items, [{ kind: "feat", text: "release level" }]);
  assert.deepEqual(p.releases[0].minors.map((m) => m.id), ["R1.2", "R1.1"], "the file's order");
  assert.equal(p.releases[0].minors[0].date, "2026-10-03");
  assert.deepEqual(p.releases[0].minors[0].items, [{ kind: "fix", text: "newest minor with a continuation" }]);
  assert.deepEqual(p.releases[0].minors[1].items.map((i) => i.kind), ["change", "note"]);
  assert.deepEqual(p.releases[1].minors.map((m) => m.id), ["R0.1"]);
  assert.deepEqual(p.releases[1].items, [{ kind: "feat", text: "first" }]);
  assert.equal(p.ignored, 0);
});

test("release ids sort R0 < R0.1 < R0.2 < R1 < R1.1 < R10", () => {
  const ids = ["R10", "R1.1", "R0.2", "R1", "R0", "R0.1"];
  assert.deepEqual([...ids].sort(compareReleaseIds), ["R0", "R0.1", "R0.2", "R1", "R1.1", "R10"]);
  assert.ok(compareReleaseIds("R0.10", "R0.9") > 0, "numeric, not text");
  assert.ok(compareReleaseIds("R9", "R10") < 0);
  assert.equal(compareReleaseIds("r1", "R1"), 0, "case does not matter");
  assert.ok(compareReleaseIds("beta", "R0") < 0, "an id that is not R<n> sorts before the real ones");
  assert.equal(compareReleaseIds("x", "x"), 0);
});

test("parseReleaseId and splitReleaseId", () => {
  assert.deepEqual(parseReleaseId("R0.2"), { major: 0, minor: 2 });
  assert.deepEqual(parseReleaseId(" R3 "), { major: 3, minor: null });
  for (const bad of ["", "R", "R0.", "R0.1.2", "0.1", "Unreleased", null, undefined]) assert.equal(parseReleaseId(bad), null, String(bad));
  assert.deepEqual(splitReleaseId("R0.1"), { major: "R0", minor: "R0.1" });
  assert.deepEqual(splitReleaseId("R7"), { major: "R7", minor: null });
  assert.deepEqual(splitReleaseId("beta"), { major: null, minor: null });
});

test("newestReleaseId returns the newest minor of the newest release, wherever it sits in the file", () => {
  assert.equal(newestReleaseId(parseChangelog(NESTED)), "R1.2");
  assert.equal(newestReleaseId(parseChangelog("## R1 — 2026-10-01\n### R1.1 — d\n- fix: a\n### R1.3 — d\n- fix: b\n### R1.2 — d\n- fix: c\n")), "R1.3");
  assert.equal(newestReleaseId(parseChangelog("## Unreleased\n### R0.1\n- fix: x\n## R0 — 2026-09-27\n- feat: y\n")), "R0", "an Unreleased section's minors do not count");
});

test("malformed minor headings are tolerated and counted", () => {
  const p = parseChangelog("### R0.1 — before any release\n- fix: orphan\n## R0 — 2026-09-27\n### \n- fix: under a bare heading\n###\n### R0.2 — not-a-date\n- shout: unknown kind\nprose\n#### deeper\n");
  assert.equal(p.releases.length, 1);
  assert.deepEqual(p.releases[0].items, [], "bullets under a minor heading are the minor's, never the release's");
  assert.deepEqual(p.releases[0].minors.map((m) => m.id), ["(untitled)", "(untitled)", "R0.2"]);
  assert.deepEqual(p.releases[0].minors[0].items, [{ kind: "fix", text: "under a bare heading" }]);
  assert.equal(p.releases[0].minors[2].label, "not-a-date");
  assert.deepEqual(p.releases[0].minors[2].items, [{ kind: "note", text: "shout: unknown kind" }]);
  assert.equal(p.ignored, 6); // orphan heading, its bullet, two bare ###, prose, #### deeper
});

test("a minor heading without a release above it is ignored, never attached to the wrong place", () => {
  const p = parseChangelog("### R0.1 — 2026-09-27\n- fix: orphan\n");
  assert.equal(p.releases.length, 0);
  assert.equal(p.ignored, 2);
});

test("the RELEASE file names the newest release in CHANGELOG.md (minor releases included), so the badge and the changelog cannot disagree", () => {
  const p = parseChangelog(fs.readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"));
  const release = fs.readFileSync(new URL("../RELEASE", import.meta.url), "utf8").trim();
  assert.equal(release, newestReleaseId(p));
});

// ---------- junk ids (R1.1): only R<digits> and R<digits>.<digits> count ----------
test("junk release and minor ids never win newestReleaseId: __proto__, constructor, toString, hasOwnProperty, words, versions, empty digits", () => {
  const junk = ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty", "valueOf", "beta", "latest", "v1", "1.0", "1.2.3", "R", "R.1", "R1.", "R1.2.3", "R1a", "RR1", "R-1", "R 1", "Release 9", "R１", "R1e3", "R0x10", "R1 .2"];
  for (const id of junk) {
    const text = `## ${id} — 2026-12-31\n- feat: junk\n\n## R2 — 2026-10-01\n- feat: real\n\n## R1 — 2026-09-01\n- feat: older\n`;
    const p = parseChangelog(text);
    assert.equal(newestReleaseId(p), "R2", `"${id}" must not win`);
    // as a MINOR heading under the real newest release
    const q = parseChangelog(`## R2 — 2026-10-01\n### ${id} — 2026-10-02\n- fix: junk\n### R2.1 — 2026-10-03\n- fix: real\n`);
    assert.equal(newestReleaseId(q), "R2.1", `"${id}" as a minor must not win`);
    assert.equal(parseReleaseId(id), null, `parseReleaseId("${id}")`);
    assert.deepEqual(splitReleaseId(id), { major: null, minor: null });
  }
});

test("a junk-only changelog has no newest release, and the parser neither throws nor pollutes Object.prototype", () => {
  const p = parseChangelog("## __proto__ — 2026-01-01\n- feat: a\n### constructor — x\n- fix: b\n## toString\n- note: c\n## Unreleased\n- feat: d\n");
  assert.equal(newestReleaseId(p), null);
  assert.equal(p.releases.length, 3, "the sections are still shown, as written");
  assert.equal(p.releases[0].minors.length, 1);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.keys(Object.prototype).length, 0);
  assert.equal(typeof ({}).constructor, "function");
  assert.equal(newestReleaseId(null), null);
  assert.equal(newestReleaseId({}), null);
  assert.equal(newestReleaseId({ releases: [{ id: "R1", minors: null, unreleased: false }] }), "R1", "a hand-built parse result with no minors list");
});

test("only a minor of THAT release counts, the newest valid one, even among junk; a bare R1 or R2.1 under ## R1 is ignored", () => {
  const p = parseChangelog("## R1 — d\n### R2.1 — d\n- fix: other release's number\n### __proto__\n- fix: x\n### R1 — d\n- fix: bare\n### R1.10 — d\n- fix: ten\n### R1.9 — d\n- fix: nine\n### R1.x — d\n- fix: y\n");
  assert.equal(newestReleaseId(p), "R1.10", "numeric order, and R2.1 (another release's number) is not a minor of R1");
});

test("huge or odd digit strings are refused rather than compared as Infinity or lost precision", () => {
  const big = "9".repeat(400), unsafe = "9007199254740993";
  for (const id of [`R${big}`, `R${unsafe}`, `R1.${big}`, `R1.${unsafe}`]) assert.equal(parseReleaseId(id), null, id.slice(0, 20));
  const p = parseChangelog(`## R${big} — d\n- feat: x\n## R3 — d\n- feat: y\n`);
  assert.equal(newestReleaseId(p), "R3");
  assert.equal(compareReleaseIds(`R${big}`, `R${big}`), 0, "comparing junk never gives NaN");
  assert.equal(compareReleaseIds(`R${big}`, "R0"), -1, "junk sorts before every real id");
  assert.equal(parseReleaseId("R007").major, 7, "leading zeros are digits");
});

test("the result is the canonical id: r1 -> R1, R01.02 -> R1.2; a heading with a minor number is read as that id", () => {
  assert.equal(newestReleaseId(parseChangelog("## r1 — d\n- feat: a\n")), "R1");
  assert.equal(newestReleaseId(parseChangelog("## R01 — d\n### r01.02 — d\n- fix: a\n")), "R1.2");
  assert.equal(newestReleaseId(parseChangelog("## R1.1 — d\n- fix: a\n")), "R1.1");
});

test("junk ids in hostile spellings do not break parsing of the lines after them", () => {
  const p = parseChangelog("## __proto__ — <img onerror=alert(1)>\n- feat: <script>x</script>\n### {{constructor}}\n- fix: y\n## R1 — 2026-01-01\n- feat: real\n");
  assert.deepEqual(p.releases.map((r) => r.id), ["__proto__", "R1"]);
  assert.equal(p.releases[0].items[0].text, "<script>x</script>", "the text is data; the About page escapes it");
  assert.equal(newestReleaseId(p), "R1");
});
