// Page templates: pure functions from data to HTML strings. No I/O.
import { esc } from './text.mjs';
import { versionSwitcher, versionBanner, currentVersion } from './versions.mjs';

const FAVICON =
  "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2048%2048%22%3E%3Cstyle%3E:root%7B--i:%230d0f12%7D%40media%20%28prefers-color-scheme:dark%29%7B:root%7B--i:%23f2f4f7%7D%7D%3C/style%3E%3Cdefs%3E%3ClinearGradient%20id=%22g%22%20gradientUnits=%22userSpaceOnUse%22%20x1=%224%22%20y1=%224%22%20x2=%2244%22%20y2=%2244%22%3E%3Cstop%20offset=%220%22%20stop-color=%22%238fb0ff%22/%3E%3Cstop%20offset=%221%22%20stop-color=%22%234b63f5%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20x=%224%22%20y=%2210%22%20width=%2228%22%20height=%2211%22%20rx=%225.5%22%20fill=%22var%28--i%29%22/%3E%3Crect%20x=%2216%22%20y=%2227%22%20width=%2228%22%20height=%2211%22%20rx=%225.5%22%20fill=%22none%22%20stroke=%22url%28%23g%29%22%20stroke-width=%222.8%22/%3E%3C/svg%3E";

const fmtDate = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
export const rootFor = (pagePath) => '../'.repeat(pagePath.split('/').filter(Boolean).length);

const SECTION_LABEL = { user: 'User Guide', dev: 'Developer Docs' };
const SECTION_HOME = { user: 'user-guide/', dev: 'developers/' };
const SITE_NAME = 'Line';

/**
 * Wrap a page body in the shared chrome.
 * page: { path, title, description, section: 'home'|'user'|'dev'|'none', body, nav?, headings?, sourceUrl?, canonical?, ogImage?, crumbs? }
 * nav: [{ group, items: [{ title, path }] }] for the sidebar
 */
export function layout(page, { repoUrl, buildTime, versions, basePath, version }) {
  const verList = versions && versions.length ? versions : null;
  const verCurrent = verList ? currentVersion(verList, { basePath, version }) : null;
  const switcher = verList ? versionSwitcher({ versions: verList, current: verCurrent, pagePath: page.path === '404.html' ? '' : page.path }) : '';
  const banner = verList ? versionBanner({ versions: verList, current: verCurrent }) : '';
  const root = page.root ?? rootFor(page.path);
  const { section = 'none' } = page;
  const fullTitle = page.fullTitle ? esc(page.fullTitle) : page.path === '' ? `${SITE_NAME} documentation` : `${esc(page.title)} · ${SECTION_LABEL[section] || SITE_NAME}`;
  const top = [
    ['', 'Home', 'home'],
    ['user-guide/', 'Guide', 'user'],
    ['developers/', 'For developers', 'dev'],
  ]
    .map(([href, label, key]) => `<a href="${root}${href}"${section === key ? ' aria-current="page"' : ''}>${label}</a>`)
    .join('');
  const navGroups = page.nav || [];
  const whereGroup = navGroups.find((g) => g.items.some((i) => i.path === page.path))?.group;
  const kicker = whereGroup && page.path !== SECTION_HOME[section] ? `<p class="kicker">${esc(whereGroup)}</p>` : '';
  const sidebar = page.nav
    ? `<aside class="sidebar" aria-label="${esc(SECTION_LABEL[section])} navigation"><details class="side-menu" open><summary>${esc(SECTION_LABEL[section])} menu</summary><nav>${navGroups
        .map(
          (g) =>
            `${g.group ? `<p class="side-h">${esc(g.group)}</p>` : ''}<ul>${g.items
              .map((i) => `<li><a href="${root}${i.path}"${i.path === page.path ? ' aria-current="page"' : ''}>${i.label ? `<small class="side-tag">${esc(i.label)}</small>` : ''}${esc(i.title)}</a></li>`)
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
    <a class="brand" href="${root}"><svg class="brand-mark" viewBox="0 0 48 48" width="26" height="26" aria-hidden="true" focusable="false"><defs><linearGradient id="lg" gradientUnits="userSpaceOnUse" x1="4" y1="4" x2="44" y2="44"><stop offset="0" stop-color="#8fb0ff"/><stop offset="1" stop-color="#4b63f5"/></linearGradient></defs><rect x="4" y="10" width="28" height="11" rx="5.5" fill="currentColor"/><rect x="16" y="27" width="28" height="11" rx="5.5" fill="none" stroke="url(#lg)" stroke-width="2.8"/></svg><span class="brand-name">Line</span></a>
    <nav class="primary" aria-label="Primary">${top}</nav>
    <div class="topbar-tools">
      ${switcher}
      <a class="search-link" href="${root}search/">Search</a>
      <a class="ext" href="${esc(repoUrl)}">GitHub</a>
    </div>
  </div>
</header>
${banner}
<div class="${shellClass}">
${sidebar}
<main id="main" tabindex="-1">
${crumbs}
<article data-pagefind-body${section !== 'none' && SECTION_LABEL[section] ? ` data-pagefind-filter="area:${SECTION_LABEL[section]}"` : ''}>
${kicker}${page.body}
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

export function homeBody() {
  return `<section class="hero">
  <h1>AI guesses. Construct computes.</h1>
  <p class="lede">Construct does the mechanical work of a React and TypeScript project (create, move, check, review) with small tools that give the same answer every time, and tells you every time an AI model was used. Usually none.</p>
  <p class="cta"><a class="btn primary" href="user-guide/getting-started/">Try it in 60 seconds</a><a class="cta-link" href="user-guide/examples/cockpit-plan-and-run/">See it work in the Cockpit</a></p>
</section>
<section aria-labelledby="get-h" class="home-what">
  <h2 id="get-h">What you get</h2>
  <ul class="pillars">
    <li>Files created in the right place, and a clear message when something breaks a rule.</li>
    <li>Changes you can read before anything runs, and approve one file at a time.</li>
    <li>An AI model only when you ask for one, and you see what it was given.</li>
  </ul>
</section>
<section aria-labelledby="family-h">
  <h2 id="family-h">Line: the framework, the app and the terminal</h2>
  <p><strong>Line</strong> is the whole package. <strong>Construct</strong> is the framework: the rules your project sets, the small tools that keep to them, and the plain JavaScript functions underneath that everything else calls. The <strong>Cockpit</strong> is the browser app you work in, and the <strong>command line</strong> is the same tools in a terminal. Construct and its command line are open source under the MIT licence; the Cockpit and the ready-made pipelines curated for it are not.</p>
  <div class="audiences">
    <a class="audience" href="user-guide/line/"><span class="audience-tag">Line</span><h3>The whole package</h3><p>How the framework, the app and the terminal fit together, and which parts are open.</p></a>
    <a class="audience" href="user-guide/construct/"><span class="audience-tag">Construct</span><h3>The framework</h3><p>Your rules in a file, scaffolding that follows them, what a change touches, and the core API.</p></a>
    <a class="audience" href="user-guide/cockpit/"><span class="audience-tag">Cockpit</span><h3>The app you work in</h3><p>Explore, plan, run in a branch, approve each file, review and test, in a browser.</p></a>
    <a class="audience" href="user-guide/cli/"><span class="audience-tag">CLI</span><h3>The terminal</h3><p>One command per job, for your shell, your scripts and CI.</p></a>
  </div>
  <p class="see-it">See it work: <a href="user-guide/examples/cli-scaffold-and-validate/">a broken rule caught in the terminal</a>, <a href="user-guide/examples/cockpit-plan-and-run/">a plan approved one file at a time</a>, or <a href="user-guide/examples/core-plans-and-impact/">the same work as an API</a>.</p>
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
