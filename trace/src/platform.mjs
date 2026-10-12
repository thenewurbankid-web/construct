// Platform helpers so Trace runs on macOS, Linux and Termux (Android) alike (#867).
// Every effect (platform, exec, fs) is injectable so tests never spawn or watch anything real.
import realFs from "node:fs";
import path from "node:path";
import { execFile as realExecFile, execFileSync as realExecFileSync } from "node:child_process";
import { TOP_DIRS } from "./build-info.mjs";

const OPENERS = { darwin: "open", linux: "xdg-open", android: "termux-open-url" };

/** True when `cmd` resolves on PATH (via `command -v`, which toybox sh/bash and zsh all have). */
export function commandExists(cmd, { execFileSync = realExecFileSync } = {}) {
  try { execFileSync("sh", ["-c", 'command -v "$1"', "sh", cmd], { stdio: "ignore" }); return true; } catch { return false; }
}

/** The command that opens a URL on this platform, or null when there is none installed. */
export function browserOpener(platform = process.platform, hasCommand = commandExists) {
  const cmd = OPENERS[platform];
  return cmd && hasCommand(cmd) ? cmd : null;
}

/** Open `url` in the user's browser when the platform has an opener; silently skip otherwise. */
export function openBrowser(url, { platform = process.platform, hasCommand = commandExists, execFile = realExecFile } = {}) {
  const cmd = browserOpener(platform, hasCommand);
  if (!cmd) return false;
  try { execFile(cmd, [url], () => {}); } catch { return false; } // a failed open never takes the server down
  return true;
}

/**
 * A process's command line. Reads /proc/<pid>/cmdline when it exists (Linux, Android, where toybox `ps`
 * has no `-o command=`), falls back to `ps` (macOS has no /proc). "" when neither works.
 */
export function processCommandLine(pid, { fs = realFs, execFileSync = realExecFileSync } = {}) {
  try { return fs.readFileSync(`/proc/${pid}/cmdline`).toString("utf8").split("\0").filter(Boolean).join(" "); } catch { /* no /proc */ }
  try { return String(execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" })).trim(); } catch { return ""; }
}

const IGNORED = new Set(["node_modules", ".git", "dist"]);

/** Directories worth watching for a redeploy: root (top-level files) plus the source dirs, never node_modules/.git/dist. */
export function sourceWatchDirs(root, { fs = realFs } = {}) {
  const out = [root];
  const walk = (dir) => {
    out.push(dir);
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory() && !IGNORED.has(e.name)) walk(path.join(dir, e.name));
  };
  for (const top of [...TOP_DIRS, "docs"]) {
    let isDir = false;
    try { isDir = fs.readdirSync(root, { withFileTypes: true }).some((e) => e.name === top && e.isDirectory()); } catch { /* none */ }
    if (isDir) walk(path.join(root, top));
  }
  return out;
}

/**
 * Watch the source dirs non-recursively (recursive watches over node_modules hit ENOSPC on Android's inotify
 * limit), calling `onChange(relPath)` with paths relative to root. Dirs created after start are not picked up.
 */
export function watchSources(root, onChange, { fs = realFs } = {}) {
  return sourceWatchDirs(root, { fs }).map((dir) =>
    fs.watch(dir, {}, (_ev, file) => { if (file) onChange(path.relative(root, path.join(dir, String(file)))); }));
}
