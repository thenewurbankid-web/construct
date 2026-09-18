#!/usr/bin/env node
// Build the Construct user-guide site from the Demos tickets on GitHub.
//   node site/build.mjs [--out site/dist] [--repo owner/name] [--offline fixtures.json] [--epic 125]
// Uses GITHUB_TOKEN / GH_TOKEN when set (higher rate limit), otherwise unauthenticated.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubSource, offlineSource } from './lib/sources.mjs';
import { collectGuides } from './lib/collect.mjs';
import { extractImageUrls, rewriteImages, localImageName } from './lib/images.mjs';
import { renderHome, renderGuide, renderTryIt, render404 } from './lib/pages.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = 'thenewurbankid-web/construct';

export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) opts[a.slice(2)] = argv[++i];
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

export async function build({ source, out, repo, buildTime = new Date(), epic = 125, basePath }) {
  const repoUrl = `https://github.com/${repo}`;
  const [owner, name] = repo.split('/');
  const siteUrl = `https://${owner}.github.io/${name}/`;
  basePath ??= `/${name}/`;
  const { guides, skipped, mode } = await collectGuides(source, { epicNumber: epic });
  const failures = [];
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const map = await downloadImages(source, guides, out, failures);

  for (const g of guides) {
    for (const s of g.stories) {
      s.html = rewriteImages(s.html, map, { prefix: '../../' });
      s.referenceHtml = rewriteImages(s.referenceHtml, map, { prefix: '../../' });
      s.benefitHtml = rewriteImages(s.benefitHtml, map, { prefix: '../../' });
    }
    g.introHtml = rewriteImages(g.introHtml, map, { prefix: '../../' });
    g.benefitHtml = rewriteImages(g.benefitHtml, map, { prefix: '../../' });
    g.heroLocal = g.hero && map[g.hero] ? map[g.hero] : null;
    g.heroAbs = g.heroLocal ? siteUrl + g.heroLocal : undefined;
    if (!g.heroLocal) g.hero = null; // no failed hotlink on the home page
  }

  const write = (rel, content) => {
    const file = path.join(out, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  write('index.html', renderHome({ guides, repoUrl, buildTime, siteUrl }));
  write('try-it.html', renderTryIt({ repoUrl, buildTime, siteUrl }));
  write('404.html', render404({ repoUrl, buildTime, basePath }));
  for (const g of guides) write(`guides/${g.slug}/index.html`, renderGuide({ guide: g, guides, repoUrl, buildTime, siteUrl }));
  fs.cpSync(path.join(HERE, 'assets'), path.join(out, 'assets'), { recursive: true });
  write('.nojekyll', '');
  write('sitemap.txt', ['', 'try-it.html', ...guides.map((g) => `guides/${g.slug}/`)].map((p) => siteUrl + p).join('\n') + '\n');

  return {
    mode,
    guides: guides.length,
    stories: guides.reduce((n, g) => n + g.stories.length, 0),
    images: Object.keys(map).length,
    imageFailures: failures,
    skipped,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  const repo = opts.repo || process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const source = opts.offline ? offlineSource(opts.offline) : githubSource({ repo, token });
  const out = path.resolve(opts.out || path.join(HERE, 'dist'));
  const result = await build({ source, out, repo, epic: Number(opts.epic || 125) });
  console.log(`Built ${out} from ${source.label} (${result.mode})`);
  console.log(`  guides: ${result.guides}  stories: ${result.stories}  images: ${result.images}`);
  for (const s of result.skipped) console.log(`  skipped #${s.number}: ${s.reason}`);
  for (const f of result.imageFailures) console.warn(`  image failed: ${f.url} (${f.error})`);
  if (!result.guides) {
    console.error('No publishable guides found; refusing to deploy an empty site.');
    process.exit(1);
  }
}
