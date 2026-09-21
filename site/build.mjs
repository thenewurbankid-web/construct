#!/usr/bin/env node
// Build the Construct documentation site (User Guide + Developer Docs).
//   node site/build.mjs [--out site/dist] [--repo owner/name] [--no-search]
//                       [--base-path /name/X.Y/] [--version X.Y|next] [--versions-file versions.json]
// --base-path is where THIS build is served (canonical URLs, sitemap, 404); --versions-file lists every
// published version for the header switcher and banner (site/lib/versions.mjs, site/build-all.mjs).
// Every page is authored under site/content or reused from the repository (README.md, docs/*.md,
// src/ast/README.md) and rendered at build time, so the build needs no network and no token.
// The CLI reference and the rule reference are generated from the code itself.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { layout, docBody, homeBody, sectionBody, searchBody, notFoundBody, redirectPage, rootFor } from './lib/pages.mjs';
import { normalizeBase } from './lib/versions.mjs';
import { renderMarkdown } from './lib/markdown.mjs';
import { USER_GROUPS, DEV_GROUPS, USER_INDEX, DEV_INDEX, generatedMarkdown, listGroups, userPages } from './lib/structure.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const DEFAULT_REPO = 'thenewurbankid-web/construct';

export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-search') opts['no-search'] = true;
    else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i];
  }
  return opts;
}

const stripLeadingH1 = (md) => md.replace(/^\s*#\s+[^\n]*\n+/, '');

export async function build({ out, repo, buildTime = new Date(), basePath, version, versions, search = false, repoRoot = REPO_ROOT }) {
  const repoUrl = `https://github.com/${repo}`;
  const [owner, name] = repo.split('/');
  basePath = normalizeBase(basePath ?? `/${name}/`);
  const siteUrl = `https://${owner}.github.io${basePath}`;
  const chrome = { repoUrl, buildTime, versions, basePath, version };
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const written = [];
  const write = (rel, content) => {
    const file = path.join(out, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    written.push(rel);
  };

  // ---- page registry ----------------------------------------------------
  const userGroups = USER_GROUPS.map((g) => ({ ...g }));
  const flat = (groups) => groups.flatMap((g) => g.pages);
  const allUserPages = [USER_INDEX, ...userPages()];
  const devPages = [DEV_INDEX, ...flat(DEV_GROUPS)];
  const resolveMap = new Map();
  for (const p of [...allUserPages, ...devPages]) if (p.source) resolveMap.set(p.source, p.path);
  resolveMap.set('docs/capabilities.md', 'developers/building-blocks/');

  const userNav = [
    { group: null, items: [{ title: 'Overview', path: USER_INDEX.path }] },
    ...userGroups.map((g) => ({ group: g.group, items: g.pages.map((p) => ({ title: p.navTitle || p.title, path: p.path, label: p.example ? 'Example' : '' })) })),
  ];
  const devNav = [{ group: null, items: [{ title: 'Overview', path: DEV_INDEX.path }] }, ...DEV_GROUPS.map((g) => ({ group: g.group, items: g.pages.map((p) => ({ title: p.title, path: p.path })) }))];
  const order = (nav) => nav.flatMap((g) => g.items.filter((i) => !/^All /.test(i.title)));
  const neighbours = (nav, p) => {
    const seq = order(nav);
    const i = seq.findIndex((x) => x.path === p);
    return i < 0 ? {} : { prev: seq[i - 1], next: seq[i + 1] };
  };

  const blobUrl = (file) => `${repoUrl}/blob/main/${file}`;
  const renderDoc = async (def, section, nav) => {
    const root = rootFor(def.path);
    let md;
    let srcFile;
    if (def.generate) {
      md = await generatedMarkdown(def.generate, repoRoot);
      srcFile = def.source;
    } else {
      md = fs.readFileSync(path.join(repoRoot, def.file), 'utf8');
      srcFile = def.source || def.file;
      if (!def.file.startsWith('site/content/')) md = stripLeadingH1(md);
    }
    const resolvePage = (p) => (resolveMap.has(p) ? root + resolveMap.get(p) : null);
    const { html, headings } = renderMarkdown(md, { repoRoot, repoUrl, source: srcFile, resolvePage, root });
    return { html, headings, srcFile, root };
  };

  const pageOut = (def, section, nav, rendered, extra = {}) => {
    const url = siteUrl + def.path;
    write(
      `${def.path}index.html`,
      layout(
        {
          path: def.path,
          title: def.title,
          description: def.description,
          section,
          nav,
          headings: rendered?.headings,
          sourceUrl: rendered ? blobUrl(rendered.srcFile) : undefined,
          canonical: url,
          ...neighbours(nav, def.path),
          ...extra,
        },
        chrome,
      ),
    );
  };

  // ---- user guide -------------------------------------------------------
  {
    const rendered = await renderDoc(USER_INDEX, 'user', userNav);
    const groups = [
      ...userGroups.map((g) => ({ group: g.group, items: g.pages.map((p) => ({ title: p.title, path: p.path, description: p.description })) })),
    ];
    pageOut(USER_INDEX, 'user', userNav, rendered, { body: sectionBody({ title: USER_INDEX.title, lede: USER_INDEX.description, html: rendered.html, groups, root: rendered.root }), prev: undefined, next: undefined });
  }
  for (const p of userPages()) {
    const rendered = await renderDoc(p, 'user', userNav);
    if (p.list) {
      const groups = listGroups(p.list).map((g) => ({ group: g.group, items: g.items.map((i) => ({ title: i.title, path: i.path, description: i.description })) }));
      pageOut(p, 'user', userNav, rendered, { body: sectionBody({ title: p.title, lede: p.description, html: rendered.html, groups, root: rendered.root }), prev: undefined, next: undefined });
    } else {
      pageOut(p, 'user', userNav, rendered, { body: docBody({ title: p.title, lede: p.description, html: rendered.html }) });
    }
  }
  // Old addresses of the retired ticket-based tutorials.
  write('user-guide/tutorials/index.html', redirectPage({ to: '../examples/', title: 'Examples' }));

  // ---- developer docs ---------------------------------------------------
  {
    const rendered = await renderDoc(DEV_INDEX, 'dev', devNav);
    pageOut(DEV_INDEX, 'dev', devNav, rendered, { body: sectionBody({ title: DEV_INDEX.title, lede: DEV_INDEX.description, html: rendered.html, groups: [], root: rendered.root }), prev: undefined, next: undefined });
  }
  for (const p of flat(DEV_GROUPS)) {
    const rendered = await renderDoc(p, 'dev', devNav);
    pageOut(p, 'dev', devNav, rendered, { body: docBody({ title: p.title, lede: p.description, html: rendered.html }) });
  }

  // ---- home, search, 404, redirects ------------------------------------
  write('index.html', layout({ path: '', title: 'Construct', description: 'Documentation for Construct: build and refactor React + TypeScript apps with deterministic blocks. A User Guide for people using it and Developer Docs for people building on it.', section: 'home', body: homeBody(), crumbs: false, canonical: siteUrl }, chrome));
  write('search/index.html', layout({ path: 'search/', title: 'Search', description: 'Search the Construct documentation.', section: 'none', body: searchBody({ root: '../' }), canonical: siteUrl + 'search/' }, chrome));
  write('404.html', layout({ path: '404.html', root: '', fullTitle: 'Page not found · Construct', description: 'Page not found.', section: 'none', body: notFoundBody({ basePath }), crumbs: false, basePath }, chrome));
  write('try-it.html', redirectPage({ to: 'user-guide/getting-started/', title: 'Getting started' }));
  fs.cpSync(path.join(HERE, 'assets'), path.join(out, 'assets'), { recursive: true });
  write('.nojekyll', '');
  const pagePaths = written.filter((f) => f.endsWith('index.html') && !f.startsWith('user-guide/tutorials/')).map((f) => f.replace(/index\.html$/, ''));
  write('sitemap.txt', pagePaths.map((p) => siteUrl + p).join('\n') + '\n');

  let searchIndexed = null;
  if (search) {
    const bin = path.join(repoRoot, 'node_modules', '.bin', 'pagefind');
    const r = spawnSync(bin, ['--site', out, '--quiet'], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`pagefind failed: ${r.stderr || r.stdout || r.error}`);
    searchIndexed = true;
  }

  return {
    examples: userPages().filter((p) => p.example).length,
    pages: written.filter((f) => f.endsWith('.html')).length,
    searchIndexed,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  const repo = opts.repo || process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const out = path.resolve(opts.out || path.join(HERE, 'dist'));
  const versions = opts['versions-file'] ? JSON.parse(fs.readFileSync(opts['versions-file'], 'utf8')).versions : undefined;
  const result = await build({ out, repo, basePath: opts['base-path'], version: opts.version, versions, search: !opts['no-search'] });
  console.log(`Built ${out}`);
  console.log(`  pages: ${result.pages}  examples: ${result.examples}  search: ${result.searchIndexed ? 'indexed' : 'off'}`);
}
