// Small shared helpers for the eval harness. Nothing here reads a clock or Math.random: results must be a
// pure function of the corpus and the code under test (timing is measured elsewhere and kept apart).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// mulberry32: a tiny seeded PRNG. Same seed, same stream, on every machine.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A string (case id, category) to a 32-bit seed, so seeds can be derived without a clock.
export function seedFrom(...parts) {
  return crypto.createHash("sha1").update(parts.join("\u0000")).digest().readUInt32BE(0);
}

export function rngTools(seed) {
  const next = mulberry32(seed);
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)); // inclusive
  const pick = (arr) => arr[int(0, arr.length - 1)];
  const chance = (p) => next() < p;
  // Fisher-Yates on a copy
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = int(0, i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const sample = (arr, k) => shuffle(arr).slice(0, k);
  return { next, int, pick, chance, shuffle, sample };
}

// JSON with sorted keys at every depth: the one serialisation used for every hash and every report file.
export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
export const stable = (v, indent = 2) => JSON.stringify(sortKeys(v), null, indent);
export const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
export const hashOf = (v) => sha(typeof v === "string" ? v : JSON.stringify(sortKeys(v)));

export function writeJson(file, v) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stable(v) + "\n");
}
export const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

export const here = (...p) => path.join(path.dirname(new URL(import.meta.url).pathname), ...p);
export const ROOT = path.resolve(here(".."));

// Rounds for display and JSON so float noise never reaches a report.
export const round = (x, d = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
