// A small git-style line diff (LCS), grouped into hunks with context. No dependency.
//   diffFile(prev, next) -> { status: "added" | "modified" | "unchanged", added, removed, hunks: [{ header, lines: [{ t: " " | "+" | "-", text, a, b }] }] }
const CONTEXT = 3;
const MAX_CELLS = 4_000_000; // beyond this a file is shown as a full replacement instead of diffed

const split = (s) => (s === "" ? [] : s.replace(/\n$/, "").split("\n"));

/**
 * A git-style line diff between two file contents, grouped into hunks with 3 lines of context (LCS-based).
 *
 * @param {string|null|undefined} prev Previous content, or `null`/`undefined` when the file did not exist.
 * @param {string} next New content.
 * @returns {{status: "added"|"modified"|"unchanged", added: number, removed: number,
 *   hunks: {header: string, lines: {t: " "|"+"|"-", text: string, a: number|null, b: number|null}[]}[]}}
 *   `status`, the added/removed line counts, and the hunks (each hunk's lines carry both old (`a`) and new (`b`)
 *   1-based line numbers, `null` on the side a line does not exist). Beyond `MAX_CELLS` cells the diff falls back
 *   to a full remove-then-add instead of running the O(n·m) LCS.
 */
export function diffFile(prev, next) {
  if (prev === null || prev === undefined) {
    const B = split(next);
    return { status: "added", added: B.length, removed: 0, hunks: B.length ? [{ header: `@@ -0,0 +1,${B.length} @@`, lines: B.map((text, i) => ({ t: "+", text, a: null, b: i + 1 })) }] : [] };
  }
  if (prev === next) return { status: "unchanged", added: 0, removed: 0, hunks: [] };
  const A = split(prev), B = split(next);

  // trim the common head and tail, then LCS the middle
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length, eb = B.length;
  while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const a = A.slice(s, ea), b = B.slice(s, eb);

  const ops = []; // { t, text }
  for (let i = 0; i < s; i++) ops.push({ t: " ", text: A[i] });
  if (a.length * b.length > MAX_CELLS) {
    a.forEach((text) => ops.push({ t: "-", text }));
    b.forEach((text) => ops.push({ t: "+", text }));
  } else {
    const n = a.length, m = b.length;
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { ops.push({ t: " ", text: a[i] }); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) ops.push({ t: "-", text: a[i++] });
      else ops.push({ t: "+", text: b[j++] });
    }
    while (i < n) ops.push({ t: "-", text: a[i++] });
    while (j < m) ops.push({ t: "+", text: b[j++] });
  }
  for (let i = ea; i < A.length; i++) ops.push({ t: " ", text: A[i] });

  // number the lines, then cut hunks around the changes
  let la = 0, lb = 0;
  const lines = ops.map((o) => ({ ...o, a: o.t === "+" ? null : ++la, b: o.t === "-" ? null : ++lb }));
  const keep = new Array(lines.length).fill(false);
  lines.forEach((l, i) => { if (l.t !== " ") for (let k = Math.max(0, i - CONTEXT); k <= Math.min(lines.length - 1, i + CONTEXT); k++) keep[k] = true; });
  const hunks = [];
  for (let i = 0; i < lines.length; ) {
    if (!keep[i]) { i++; continue; }
    let j = i;
    while (j < lines.length && keep[j]) j++;
    const hl = lines.slice(i, j);
    const aStart = hl.find((l) => l.a)?.a ?? 0, bStart = hl.find((l) => l.b)?.b ?? 0;
    const aLen = hl.filter((l) => l.t !== "+").length, bLen = hl.filter((l) => l.t !== "-").length;
    hunks.push({ header: `@@ -${aStart},${aLen} +${bStart},${bLen} @@`, lines: hl });
    i = j;
  }
  return { status: "modified", added: lines.filter((l) => l.t === "+").length, removed: lines.filter((l) => l.t === "-").length, hunks };
}
