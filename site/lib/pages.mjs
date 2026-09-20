// Page templates: pure functions from data to HTML strings. No I/O.
import { esc } from './text.mjs';

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230b0d12'/%3E%3Cpath d='M9 9h14v4H13v6h10v4H9z' fill='%235b8cff'/%3E%3C/svg%3E";

const fmtDate = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
export const rootFor = (pagePath) => '../'.repeat(pagePath.split('/').filter(Boolean).length);

const SECTION_LABEL = { user: 'User Guide', dev: 'Developer Docs' };
const SECTION_HOME = { user: 'user-guide/', dev: 'developers/' };
const SITE_NAME = 'Construct';

/**
 * Wrap a page body in the shared chrome.
 * page: { path, title, description, section: 'home'|'user'|'dev'|'none', body, nav?, headings?, sourceUrl?, canonical?, ogImage?, crumbs? }
 * nav: [{ group, items: [{ title, path }] }] for the sidebar
 */
export function layout(page, { repoUrl, buildTime }) {
  const root = page.root ?? rootFor(page.path);
  const { section = 'none' } = page;
  const fullTitle = page.fullTitle ? esc(page.fullTitle) : page.path === '' ? `${SITE_NAME} documentation` : `${esc(page.title)} · ${SECTION_LABEL[section] || SITE_NAME}`;
  const top = [
    ['', 'Home', 'home'],
    ['user-guide/', 'User Guide', 'user'],
    ['developers/', 'Developer Docs', 'dev'],
  ]
    .map(([href, label, key]) => `<a href="${root}${href}"${section === key ? ' aria-current="page"' : ''}>${label}</a>`)
    .join('');
  const sidebar = page.nav
    ? `<aside class="sidebar" aria-label="${esc(SECTION_LABEL[section])} navigation"><details class="side-menu" open><summary>${esc(SECTION_LABEL[section])} menu</summary><nav>${page.nav
        .map(
          (g) =>
            `${g.group ? `<p class="side-h">${esc(g.group)}</p>` : ''}<ul>${g.items
              .map((i) => `<li><a href="${root}${i.path}"${i.path === page.path ? ' aria-current="page"' : ''}>${esc(i.title)}</a></li>`)
              .join('')}</ul>`,
        )
        .join('')}</nav></details></aside>`
    : '';
  const h2s = (page.headings || []).filter((h) => h.level === 2);
  const toc = h2s.length >= 2 ? `<aside class="page-toc" aria-label="On this page"><p class="side-h">On this page</p><ul>${h2s.map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ul></aside>` : '';
  const crumbs = page.crumbs === false ? '' : `<nav class="crumbs" aria-label="Breadcrumb"><a href="${root}">Home</a>${SECTION_HOME[section] ? ` <span aria-hidden="true">/</span> <a href="${root}${SECTION_HOME[section]}">${SECTION_LABEL[section]}</a>` : ''}${page.path !== SECTION_HOME[section] && page.title ? ` <span aria-hidden="true">/</span> <span>${esc(page.title)}</span>` : ''}</nav>`;
  const pager = page.prev || page.next
    ? `<nav class="pager" aria-label="Previous and next">${page.prev ? `<a class="prev" href="${root}${page.prev.path}"><span>Previous</span>${esc(page.prev.title)}</a>` : '<span></span>'}${page.next ? `<a class="next" href="${root}${page.next.path}"><span>Next</span>${esc(page.next.title)}</a>` : ''}</nav>`
    : '';
  const shellClass = ['shell', sidebar && 'has-sidebar', toc && 'has-toc'].filter(Boolean).join(' ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${esc(page.description || '')}">
<meta name="color-scheme" content="dark light">
<meta property="og:type" content="website">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${esc(page.description || '')}">
${page.canonical ? `<meta property="og:url" content="${esc(page.canonical)}">\n<link rel="canonical" href="${esc(page.canonical)}">` : ''}
${page.ogImage ? `<meta property="og:image" content="${esc(page.ogImage)}">` : ''}
<meta name="twitter:card" content="${page.ogImage ? 'summary_large_image' : 'summary'}">
<link rel="icon" href="${FAVICON}">
${page.basePath ? `<base href="${esc(page.basePath)}">` : ''}
<link rel="stylesheet" href="${root}assets/css/site.css">
<link rel="stylesheet" href="${root}assets/css/docs.css">
</head>
<body${section === 'home' ? ' class="is-home"' : ''}>${section === 'home' ? '\n<div class="hero-slides" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>' : ''}
<a class="skip" href="#main">Skip to content</a>
<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="${root}"><span class="brand-mark" aria-hidden="true">C</span><span>Construct</span></a>
    <nav class="primary" aria-label="Primary">${top}</nav>
    <div class="topbar-tools">
      <a class="search-link" href="${root}search/">Search</a>
      <a class="ext" href="${esc(repoUrl)}">GitHub</a>
    </div>
  </div>
</header>
<div class="${shellClass}">
${sidebar}
<main id="main" tabindex="-1">
${crumbs}
<article data-pagefind-body${section !== 'none' && SECTION_LABEL[section] ? ` data-pagefind-filter="area:${SECTION_LABEL[section]}"` : ''}>
${page.body}
</article>
${pager}
</main>
${toc}
</div>
<footer class="footer"><div class="footer-inner">
<span>Construct is open source (MIT). Documentation built <time datetime="__BUILD__">__BUILD_DATE__</time>.</span>
<span>${page.sourceUrl ? `<a href="${esc(page.sourceUrl)}">View source</a> · ` : ''}<a href="${esc(repoUrl)}">GitHub</a></span>
</div></footer>
<script>(function(){var d=document.querySelector('.side-menu');if(d&&window.matchMedia&&!window.matchMedia('(min-width: 901px)').matches)d.removeAttribute('open');})();</script>
</body>
</html>
`.replaceAll('__BUILD__', new Date(buildTime).toISOString()).replaceAll('__BUILD_DATE__', fmtDate(buildTime) + ' UTC');
}

/** A docs page: title heading + lede + rendered markdown. */
export function docBody({ title, lede, html }) {
  return `<h1>${esc(title)}</h1>${lede ? `<p class="lede">${esc(lede)}</p>` : ''}<div class="prose">${html}</div>`;
}

const EXAMPLE_CARDS = [
  ['CLI', 'user-guide/examples/cli-scaffold-and-validate/', 'Scaffold, then catch a rule break', 'A fetch() in a page. Exact commands, exact output, exit code and timing.'],
  ['CLI', 'user-guide/examples/cli-impact-and-review/', 'Blast radius and branch review', 'What a change touches, and what a branch means. Same input, same hash, no model.'],
  ['Cockpit', 'user-guide/examples/cockpit-plan-and-run/', 'Plan, run in a branch, approve per file', 'A bot works in its own worktree. You approve each file on the exact diff.'],
  ['Cockpit', 'user-guide/examples/cockpit-review/', 'Review a branch by what it means', 'Five indicators from your own rules. Mechanical fixes apart from decisions.'],
  ['Core', 'user-guide/examples/core-plans-and-impact/', 'Plans and impact as an API', 'JSON in, JSON out. The functions the CLI and the Cockpit both call.'],
];

export function homeBody() {
  const cards = EXAMPLE_CARDS.map(
    ([tag, href, title, text]) => `<article class="card"><div class="card-body"><p class="eyebrow">${esc(tag)}</p><h3><a href="${href}">${esc(title)}</a></h3><p>${esc(text)}</p></div></article>`,
  ).join('\n');
  return `<section class="hero">
  <h1>AI guesses. Construct computes.</h1>
  <p class="lede">Small, deterministic blocks that build and refactor your app under your rules. Same input, same result, zero tokens. You steer from the Cockpit, a cockpit and not an autopilot.</p>
</section>
<section aria-labelledby="proof-h" class="home-what">
  <h2 id="proof-h">Problem, command, result</h2>
<pre><code>$ construct validate
❌ PAGE-004 [architecture]
  features/billing/pages/InvoicePage.tsx:7
  Page calls fetch().
  Why: Pages cannot own application flow.
  Fix: Move the responsibility to controller or workflow.

$ construct research impact features/shared/components/CurrencyLabel.tsx --dir fixtures/impact-shared --format json | sha256sum
23ffcf296120b0fc81ae9a488315189cdad748ccda74dfdc876e37fb9cb3493a  -
$ (run it again)
23ffcf296120b0fc81ae9a488315189cdad748ccda74dfdc876e37fb9cb3493a  -</code></pre>
  <ul class="pillars">
    <li><strong>Deterministic blocks.</strong> Scaffold, validate, refactor, measure impact, review a branch, generate tests. Every command ends by saying how many model calls it made. Usually zero.</li>
    <li><strong>A model only where you ask for one.</strong> Its task is small, its guidance is a real example, and your own rules check its output before it ships.</li>
    <li><strong>Watch and steer.</strong> Plans you can read, bots that work in their own branch, changes you approve one file at a time.</li>
  </ul>
</section>
<section aria-label="Choose your path">
  <h2>Three surfaces, kept apart</h2>
  <p class="section-note">The same blocks are reachable three ways. Each is documented on its own, never mixed.</p>
  <div class="audiences">
    <a class="audience" href="user-guide/examples/cli-scaffold-and-validate/"><span class="audience-tag">CLI</span><h2>Commands</h2><p>Real commands and real output, for scripts, CI and the terminal.</p><span class="audience-go">CLI examples</span></a>
    <a class="audience" href="user-guide/examples/cockpit-plan-and-run/"><span class="audience-tag">Cockpit</span><h2>The browser UI</h2><p>Explore, Plan, Build and Review, with real screenshots.</p><span class="audience-go">Cockpit examples</span></a>
    <a class="audience" href="user-guide/examples/core-plans-and-impact/"><span class="audience-tag">Core</span><h2>The API</h2><p>Plain JavaScript functions, JSON in and out, open source.</p><span class="audience-go">Core examples</span></a>
  </div>
</section>
<section aria-labelledby="ex-h"><h2 id="ex-h">Examples</h2>
  <p class="section-note">Each one names the problem, then shows the exact command or screen and exactly what came back.</p>
  <div class="cards">${cards}</div>
  <p class="section-note"><a href="user-guide/examples/">All examples</a> · <a href="user-guide/getting-started/">Getting started</a> · <a href="developers/">Developer Docs</a></p>
</section>`;
}

/** A section landing page: intro + a card list of its pages. */
export function sectionBody({ title, lede, html, groups, root }) {
  const list = groups
    .map(
      (g) => `<section class="doc-group"><h2>${esc(g.group)}</h2><ul class="doc-list">${g.items
        .map((i) => `<li><a href="${root}${i.path}"><strong>${esc(i.title)}</strong>${i.description ? `<span>${esc(i.description)}</span>` : ''}</a></li>`)
        .join('')}</ul></section>`,
    )
    .join('');
  return `<h1>${esc(title)}</h1><p class="lede">${esc(lede)}</p><div class="prose">${html || ''}</div>${list}`;
}

export function searchBody({ root }) {
  return `<h1>Search</h1>
<p class="lede">Search the User Guide and Developer Docs.</p>
<div id="search" data-root="${root}"></div>
<noscript><p>Search needs JavaScript. Browse the <a href="${root}user-guide/">User Guide</a> or the <a href="${root}developers/">Developer Docs</a> instead.</p></noscript>
<link href="${root}pagefind/pagefind-ui.css" rel="stylesheet">
<script src="${root}pagefind/pagefind-ui.js"></script>
<script>
window.addEventListener('DOMContentLoaded', function () {
  var el = document.getElementById('search');
  if (!window.PagefindUI) { el.textContent = 'Search index is not available in this build.'; return; }
  var ui = new PagefindUI({ element: '#search', showSubResults: true, showImages: false, resetStyles: false, translations: { placeholder: 'Search the docs' } });
  var q = new URLSearchParams(location.search).get('q');
  if (q) ui.triggerSearch(q);
});
</script>`;
}

export function redirectPage({ to, title }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${esc(to)}"><link rel="canonical" href="${esc(to)}"></head><body data-pagefind-ignore><p>This page has moved to <a href="${esc(to)}">${esc(to)}</a>.</p></body></html>
`;
}

export function notFoundBody({ basePath }) {
  return `<div class="notfound"><p class="eyebrow">404</p><h1>That page does not exist.</h1><p class="lede">It may have been renamed or removed.</p><p class="cta"><a class="btn primary" href="${esc(basePath || './')}">Back to the documentation</a></p></div>`;
}
