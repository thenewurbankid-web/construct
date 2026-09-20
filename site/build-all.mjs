#!/usr/bin/env node
// Build every version of the documentation site into ONE directory (GitHub Pages replaces the whole site).
//   node site/build-all.mjs [--out site/dist] [--repo owner/name] [--no-search] [--next-ref HEAD]
// Layout of the artifact: / = newest release (or main when there are no tags), /X.Y/ = newest patch of each
// minor, /next/ = main. Each ref is checked out into a temporary git worktree and built with THAT ref's own
// site/build.mjs, so a release always renders exactly as it was tagged. Offline and deterministic: the site
// build needs no network. Policy: docs/VERSIONING.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planBuilds } from './lib/versions.mjs';
import { parseArgs } from './build.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const DEFAULT_REPO = 'thenewurbankid-web/construct';

const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').trim()}`);
  return r.stdout;
};

export const listTags = (repoDir) => git(repoDir, ['tag', '--list', 'v*.*.*']).split('\n').map((t) => t.trim()).filter(Boolean);

/** Build one ref into `dest` by running that ref's own site/build.mjs inside a temporary worktree. */
export function buildRef({ repoDir, ref, dest, args, scratch }) {
  const wt = fs.mkdtempSync(path.join(scratch, 'wt-'));
  git(repoDir, ['worktree', 'add', '--detach', '--force', wt, ref]);
  try {
    const script = path.join(wt, 'site', 'build.mjs');
    if (!fs.existsSync(script) || !fs.readFileSync(script, 'utf8').includes('--base-path')) {
      throw new Error(`${ref} predates versioned docs (its site/build.mjs has no --base-path). Only refs that contain #397 can be published.`);
    }
    // The site build reads generated docs from the code and runs pagefind: reuse the installed dependencies.
    const nm = path.join(repoDir, 'node_modules');
    if (fs.existsSync(nm) && !fs.existsSync(path.join(wt, 'node_modules'))) fs.symlinkSync(nm, path.join(wt, 'node_modules'), 'dir');
    const r = spawnSync(process.execPath, [script, '--out', dest, ...args], { cwd: wt, encoding: 'utf8', env: process.env });
    if (r.status !== 0) throw new Error(`build of ${ref} failed:\n${r.stderr || r.stdout}`);
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: repoDir });
  }
}

/**
 * Plan and build all versions into `out`. `run` builds one ref (injectable for tests).
 * Returns the plan plus what was written.
 */
export function buildAll({ repoDir = REPO_ROOT, out, repo = DEFAULT_REPO, search = true, nextRef = 'HEAD', tags, run = buildRef }) {
  const name = repo.split('/')[1];
  const siteBase = `/${name}/`;
  const plan = planBuilds(tags ?? listTags(repoDir), { siteBase, nextRef });
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-site-'));
  try {
    const versionsFile = path.join(scratch, 'versions.json');
    fs.writeFileSync(versionsFile, JSON.stringify({ versions: plan.versions }, null, 2));
    // Sub-paths first, the root last, so the root can never be clobbered by a version directory.
    const ordered = [...plan.builds].sort((a, b) => Number(a.dir === '') - Number(b.dir === ''));
    for (const b of ordered) {
      const dest = path.join(scratch, `out-${b.dir || 'root'}`);
      const base = b.dir ? `${siteBase}${b.dir}/` : siteBase;
      const args = ['--repo', repo, '--base-path', base, '--version', b.id, '--versions-file', versionsFile, ...(search ? [] : ['--no-search'])];
      run({ repoDir, ref: b.ref, dest, args, scratch });
      fs.cpSync(dest, b.dir ? path.join(out, b.dir) : out, { recursive: true });
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return plan;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  const repo = opts.repo || process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const out = path.resolve(opts.out || path.join(HERE, 'dist'));
  const plan = buildAll({ repoDir: opts['repo-dir'] ? path.resolve(opts['repo-dir']) : REPO_ROOT, out, repo, search: !opts['no-search'], nextRef: opts['next-ref'] || 'HEAD' });
  console.log(`Built ${out}`);
  for (const b of plan.builds) console.log(`  /${b.dir ? b.dir + '/' : ''}  <- ${b.ref} (${b.label}${b.latest ? ', latest' : ''})`);
}
