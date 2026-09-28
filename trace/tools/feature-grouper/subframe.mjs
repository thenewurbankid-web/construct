// Runs feature-grouper across the subframe-app pages: groups each page's source, then loads its route in a
// real browser (Playwright + Chromium) and screenshots it. No hand labels exist for these pages, so this is a
// smoke + sanity check (does the page render, do the groups look plausible), not an accuracy score.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { groupPage } from "./grouper.mjs";
import { ROOT } from "./group.mjs";

const APP_DIR = path.join(ROOT, "subframe-app");
export const OUT_DIR = path.join(import.meta.dirname, "out", "subframe");

/**
 * The subframe-app pages, read from `src/App.tsx`'s hash router (the `PAGES` map: route key -> component file).
 * Falls back to nothing (not a guess) if the router shape changes.
 *
 * @returns {{route: string, label: string, file: string}[]} One entry per page, in the order App.tsx lists them.
 */
export function subframePages() {
  const appFile = path.join(APP_DIR, "src", "App.tsx");
  const app = fs.readFileSync(appFile, "utf8");
  const importRe = /import\s+(\w+)\s+from\s+"(\.\/pages\/[^"]+)"/g;
  const files = new Map();
  for (const m of app.matchAll(importRe)) files.set(m[1], path.join(APP_DIR, "src", m[2].replace(/^\.\//, "") + ".tsx"));
  const entryRe = /"?([\w-]+)"?:\s*\{\s*label:\s*"([^"]+)",\s*Page:\s*(\w+)\s*\}/g;
  const pages = [];
  for (const m of app.matchAll(entryRe)) {
    const file = files.get(m[3]);
    if (file && fs.existsSync(file)) pages.push({ route: m[1], label: m[2], file });
  }
  return pages;
}

/**
 * Start the subframe-app Vite dev server on `port` (or the next free one) and wait until it answers.
 *
 * @param {number} [port] First port to try (default 5190).
 * @returns {Promise<{proc: import("node:child_process").ChildProcess, port: number, base: string}>} The running
 *   server; call `.proc.kill()` to stop it.
 */
export async function startSubframeServer(port = 5190) {
  const proc = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: APP_DIR, stdio: ["ignore", "pipe", "pipe"] });
  // "localhost" (not 127.0.0.1): this sandbox's loopback routing answers on the "localhost" name reliably but not
  // consistently on the literal 127.0.0.1 address for a freshly bound dev-server port.
  const base = `http://localhost:${port}`;
  let out = "";
  proc.stdout.on("data", (d) => { out += d; });
  proc.stderr.on("data", (d) => { out += d; });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base);
      if (res.ok) return { proc, port, base };
    } catch { /* not up yet */ }
    if (proc.exitCode !== null) throw new Error(`subframe-app dev server exited early:\n${out}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error(`subframe-app dev server did not come up on ${base} within 20s:\n${out}`);
}

/**
 * Group every subframe-app page's source (no browser needed).
 *
 * @param {{embedder?: string}} [options] Passed to `groupPage`.
 * @returns {Promise<{route: string, label: string, file: string, result: object}[]>} One grouping result per page.
 */
export async function groupSubframePages(options = {}) {
  const pages = subframePages();
  const out = [];
  for (const p of pages) {
    const source = fs.readFileSync(p.file, "utf8");
    const result = await groupPage(source, { file: path.relative(ROOT, p.file), ...options });
    out.push({ ...p, result });
  }
  return out;
}

/**
 * Load every page's route in a real browser, assert it renders without a console/page error, and screenshot it.
 *
 * @param {string} base The dev server's base URL (from `startSubframeServer`).
 * @param {import("playwright").Browser} browser A launched Chromium browser.
 * @returns {Promise<{route: string, ok: boolean, errors: string[], screenshot: string}[]>} One entry per page.
 */
export async function screenshotSubframePages(base, browser) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = [];
  for (const p of subframePages()) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(`${base}/#${p.route}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300); // route swap on hashchange
    const screenshot = path.join(OUT_DIR, `${p.route}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    out.push({ route: p.route, ok: errors.length === 0, errors, screenshot });
    await page.close();
  }
  return out;
}
