#!/usr/bin/env node
// Build the Construct documentation site (User Guide + Developer Docs).
//   node site/build.mjs [--out site/dist] [--repo owner/name] [--offline fixtures.json] [--epic 125] [--no-search]
// Reused repository docs (README.md, docs/*.md, src/ast/README.md) are rendered at build time; the tutorials
// come from the published guide tickets on GitHub. Uses GITHUB_TOKEN / GH_TOKEN when set (higher rate limit).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { githubSource, offlineSource } from './lib/sources.mjs';
import { collectGuides } from './lib/collect.mjs';
import { extractImageUrls, rewriteImages, localImageName } from './lib/images.mjs';
import { layout, docBody, homeBody, sectionBody, tutorialsIndexBody, guideBody, searchBody, notFoundBody, redirectPage, rootFor } from './lib/pages.mjs';
import { renderMarkdown, stripTicketRefsHtml } from './lib/markdown.mjs';
import { USER_GROUPS, DEV_GROUPS, USER_INDEX, DEV_INDEX, TUTORIALS_INDEX, generatedMarkdown } from './lib/structure.mjs';

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

/** Download every remote image referenced by the guides; returns { url: 'assets/img/<hash>.<ext>' }. */
async function downloadImages(source, guides, outDir, failures) {
  const urls = new Set();
  for (const g of guides) {
    if (g.hero) urls.add(g.hero);
    for (const html of [g.introHtml, g.benefitHtml, ...g.stories.flatMap((s) => [s.html, s.referenceHtml, s.benefitHtml])]) {
      for (const u of extractImageUrls(html || '')) urls.add(u);
    }
  }
  const map = {};
  const dir = path.join(outDir, 'assets', 'img');
  fs.mkdirSync(dir, { recursive: true });
  await Promise.all(
    [...urls].map(async (url) => {
      try {
        const { bytes, contentType } = await source.fetchImage(url);
        const name = localImageName(url, bytes, contentType);
        fs.writeFileSync(path.join(dir, name), bytes);
        map[url] = `assets/img/${name}`;
      } catch (e) {
        failures.push({ url, error: e.message });
      }
    }),
  );
  return map;
}

const stripLeadingH1 = (md) => md.replace(/^\s*#\s+[^\n]*\n+/, '');

export async function build({ source, out, repo, buildTime = new Date(), epic = 125, basePath, search = false, repoRoot = REPO_ROOT }) {
  const repoUrl = `https://github.com/${repo}`;
  const [owner, name] = repo.split('/');
  const siteUrl = `https://${owner}.github.io/${name}/`;
  basePath ??= `/${name}/`;
  const { guides, skipped, mode } = await collectGuides(source, { epicNumber: epic });
  const failures = [];
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const map = await downloadImages(source, guides, out, failures);

  // Tutorials live three levels deep: user-guide/tutorials/<slug>/
  for (const g of guides) {
    const prefix = '../../../';
    for (const s of g.stories) {
      s.html = stripTicketRefsHtml(rewriteImages(s.html, map, { prefix }));
      s.referenceHtml = stripTicketRefsHtml(rewriteImages(s.referenceHtml, map, { prefix }));
      s.benefitHtml = stripTicketRefsHtml(rewriteImages(s.benefitHtml, map, { prefix }));
    }
    g.introHtml = stripTicketRefsHtml(rewriteImages(g.introHtml, map, { prefix }));
    g.benefitHtml = stripTicketRefsHtml(rewriteImages(g.benefitHtml, map, { prefix }));
    g.heroLocal = g.hero && map[g.hero] ? map[g.hero] : null;
    g.heroAbs = g.heroLocal ? siteUrl + g.heroLocal : undefined;
  }

  const written = [];
  const write = (rel, content) => {
    const file = path.join(out, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    written.push(rel);
  };

  // ---- page registry ----------------------------------------------------
  const userGroups = USER_GROUPS.map((g) => ({ ...g }));
  const flat = (groups) => groups.flatMap((g) => [...(g.index ? [g.index] : []), ...g.pages]);
  const userPages = [USER_INDEX, ...flat(userGroups)];
  const devPages = [DEV_INDEX, ...flat(DEV_GROUPS)];
  const resolveMap = new Map();
  for (const p of [...userPages, ...devPages]) if (p.source) resolveMap.set(p.source, p.path);
  resolveMap.set('docs/capabilities.md', 'developers/building-blocks/');

  const tutorialItems = guides.map((g) => ({ title: g.title, path: `user-guide/tutorials/${g.slug}/` }));
  const userNav = [
    { group: null, items: [{ title: 'Overview', path: USER_INDEX.path }] },
    ...userGroups.map((g) => ({ group: g.group, items: [...(g.index ? [{ title: 'All how-to guides', path: g.index.path }] : []), ...g.pages.map((p) => ({ title: p.title, path: p.path }))] })),
    { group: 'Tutorials', items: [{ title: 'All tutorials', path: TUTORIALS_INDEX.path }, ...tutorialItems] },
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
        { repoUrl, buildTime },
      ),
    );
  };

  // ---- user guide -------------------------------------------------------
  {
    const rendered = await renderDoc(USER_INDEX, 'user', userNav);
    const groups = [
      ...userGroups.map((g) => ({ group: g.group, items: g.pages.map((p) => ({ title: p.title, path: p.path, description: p.description })) })),
      { group: 'Tutorials', items: [{ title: 'All tutorials', path: TUTORIALS_INDEX.path, description: TUTORIALS_INDEX.description }] },
    ];
    pageOut(USER_INDEX, 'user', userNav, rendered, { body: sectionBody({ title: USER_INDEX.title, lede: USER_INDEX.description, html: rendered.html, groups, root: rendered.root }), prev: undefined, next: undefined });
  }
  for (const g of userGroups) {
    if (g.index) {
      const rendered = await renderDoc(g.index, 'user', userNav);
      const groups = [{ group: 'Guides', items: g.pages.map((p) => ({ title: p.title, path: p.path, description: p.description })) }];
      pageOut(g.index, 'user', userNav, rendered, { body: sectionBody({ title: g.index.title, lede: g.index.description, html: rendered.html, groups, root: rendered.root }), prev: undefined, next: undefined });
    }
    for (const p of g.pages) {
      const rendered = await renderDoc(p, 'user', userNav);
      pageOut(p, 'user', userNav, rendered, { body: docBody({ title: p.title, lede: p.description, html: rendered.html }) });
    }
  }
  pageOut(TUTORIALS_INDEX, 'user', userNav, null, { body: tutorialsIndexBody({ guides, root: rootFor(TUTORIALS_INDEX.path) }), prev: undefined, next: undefined });
  for (const g of guides) {
    const gp = { path: `user-guide/tutorials/${g.slug}/`, title: g.title, description: g.summary || g.title };
    pageOut(gp, 'user', userNav, null, {
      body: guideBody({ guide: g, repoUrl, root: rootFor(gp.path) }),
      headings: g.stories.map((s) => ({ level: 2, id: s.anchor, text: s.title })),
      ogImage: g.heroAbs,
      sourceUrl: g.url,
    });
    // Old address of this tutorial.
    write(`guides/${g.slug}/index.html`, redirectPage({ to: `../../${gp.path}`, title: g.title }));
  }

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
  write('index.html', layout({ path: '', title: 'Construct', description: 'Documentation for Construct: build and refactor React + TypeScript apps with deterministic blocks. A User Guide for people using it and Developer Docs for people building on it.', section: 'home', body: homeBody({ guides }), crumbs: false, canonical: siteUrl }, { repoUrl, buildTime }));
  write('search/index.html', layout({ path: 'search/', title: 'Search', description: 'Search the Construct documentation.', section: 'none', body: searchBody({ root: '../' }), canonical: siteUrl + 'search/' }, { repoUrl, buildTime }));
  write('404.html', layout({ path: '404.html', root: '', fullTitle: 'Page not found · Construct', description: 'Page not found.', section: 'none', body: notFoundBody({ basePath }), crumbs: false, basePath }, { repoUrl, buildTime }));
  write('try-it.html', redirectPage({ to: 'user-guide/getting-started/', title: 'Getting started' }));
  fs.cpSync(path.join(HERE, 'assets'), path.join(out, 'assets'), { recursive: true });
  write('.nojekyll', '');
  const pagePaths = written.filter((f) => f.endsWith('index.html') && !f.startsWith('guides/')).map((f) => f.replace(/index\.html$/, ''));
  write('sitemap.txt', pagePaths.map((p) => siteUrl + p).join('\n') + '\n');

  let searchIndexed = null;
  if (search) {
    const bin = path.join(repoRoot, 'node_modules', '.bin', 'pagefind');
    const r = spawnSync(bin, ['--site', out, '--quiet'], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`pagefind failed: ${r.stderr || r.stdout || r.error}`);
    searchIndexed = true;
  }

  return {
    mode,
    guides: guides.length,
    stories: guides.reduce((n, g) => n + g.stories.length, 0),
    images: Object.keys(map).length,
    imageFailures: failures,
    skipped,
    pages: written.filter((f) => f.endsWith('.html')).length,
    searchIndexed,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  const repo = opts.repo || process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const source = opts.offline ? offlineSource(opts.offline) : githubSource({ repo, token });
  const out = path.resolve(opts.out || path.join(HERE, 'dist'));
  const result = await build({ source, out, repo, epic: Number(opts.epic || 125), search: !opts['no-search'] });
  console.log(`Built ${out} from ${source.label} (${result.mode})`);
  console.log(`  pages: ${result.pages}  tutorials: ${result.guides}  walkthroughs: ${result.stories}  images: ${result.images}  search: ${result.searchIndexed ? 'indexed' : 'off'}`);
  for (const s of result.skipped) console.log(`  skipped #${s.number}: ${s.reason}`);
  for (const f of result.imageFailures) console.warn(`  image failed: ${f.url} (${f.error})`);
  if (!result.guides) {
    console.error('No publishable tutorials found; refusing to deploy a site without them.');
    process.exit(1);
  }
}
