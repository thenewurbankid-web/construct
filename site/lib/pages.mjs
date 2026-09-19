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
<body${section === 'home' ? ' class="is-home"' : ''}>
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

const cardGrid = (cards) => `<div class="cards">${cards.join('\n')}</div>`;

export function guideCard(g, root) {
  const href = `${root}user-guide/tutorials/${g.slug}/`;
  return `<article class="card">
  <a class="card-media${g.heroLocal ? '' : ' ph'}" href="${href}" tabindex="-1" aria-hidden="true">${g.heroLocal ? `<img src="${root}${esc(g.heroLocal)}" alt="" loading="lazy" decoding="async">` : '<span>CLI + UI</span>'}</a>
  <div class="card-body">
    <h3><a href="${href}">${esc(g.title)}</a></h3>
    <p>${esc(g.summary)}</p>
    <p class="meta">${g.stories.length} ${g.stories.length === 1 ? 'walkthrough' : 'walkthroughs'}</p>
  </div>
</article>`;
}

export function homeBody({ guides }) {
  const root = '';
  return `<section class="hero">
  <p class="eyebrow">Documentation</p>
  <h1>Build and refactor React apps with deterministic blocks, not guesswork.</h1>
  <p class="lede">Construct is a set of small, code-driven commands that scaffold, move, import and validate a React + TypeScript app against rules your project defines. Use them from the command line or a browser Cockpit. An AI model is only involved where you explicitly ask for one.</p>
</section>
<section class="audiences" aria-label="Choose your path">
  <a class="audience" href="user-guide/">
    <span class="audience-tag">User Guide</span>
    <h2>I want to use Construct</h2>
    <p>Install it, create your first project and features, keep your code inside your own rules, and bring an existing app across. Task-based how-tos and step-by-step tutorials with real output and screenshots.</p>
    <span class="audience-go">Start with the User Guide</span>
  </a>
  <a class="audience" href="developers/">
    <span class="audience-tag">Developer Docs</span>
    <h2>I want to build on or contribute to Construct</h2>
    <p>The architecture and rule engine, the execution model, the Context Envelope pipeline, the AST package, CLI and rule references, and how to extend and test it.</p>
    <span class="audience-go">Open the Developer Docs</span>
  </a>
</section>
<section aria-labelledby="what-h" class="home-what">
  <h2 id="what-h">What Construct does</h2>
  <ul class="pillars">
    <li><strong>Create in the right place.</strong> One command scaffolds a feature or a slice across layers, in dependency order.</li>
    <li><strong>Rules you can read and change.</strong> Conventions live in <code>architecture.yml</code>; <code>construct validate</code> explains every violation and how to fix it.</li>
    <li><strong>Same blocks for people and scripts.</strong> The CLI and the Cockpit run the same code, and every command says whether a model was involved.</li>
  </ul>
<pre><code>construct init my-app
construct create layer Invoice --feature billing --layers domain,hook,page,controller
construct validate</code></pre>
</section>
${
  guides.length
    ? `<section aria-labelledby="tut-h"><h2 id="tut-h">Tutorials</h2>
  <p class="section-note">Real command output and Cockpit screenshots, one guide per goal.</p>
  ${cardGrid(guides.map((g) => guideCard(g, root)))}
  <p class="section-note"><a href="user-guide/tutorials/">All tutorials</a></p>
</section>`
    : ''
}`;
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

export function tutorialsIndexBody({ guides, root }) {
  return `<h1>Tutorials</h1>
<p class="lede">Step-by-step guides that show each capability from the command line and from the Cockpit, with real output and screenshots.</p>
${guides.length ? cardGrid(guides.map((g) => guideCard(g, root))) : '<p>No tutorials are published yet.</p>'}`;
}

function verifiedBadge(story, repoUrl) {
  return story.verified
    ? `<span class="badge" title="Checked against this commit of Construct">checked against <a href="${esc(repoUrl)}/commit/${esc(story.verified)}"><code>${esc(story.verified.slice(0, 7))}</code></a>${story.verifiedDate ? ` (${esc(story.verifiedDate)})` : ''}</span>`
    : '';
}

export function guideBody({ guide, repoUrl, root }) {
  const toc = guide.stories
    .map((s) => `<li><a href="#${s.anchor}">${esc(s.title)}</a>${s.summary && !s.summary.startsWith(s.title) ? `<span>${esc(s.summary)}</span>` : ''}${s.tocBlurb ? `<span class="toc-benefit">Benefit: ${esc(s.tocBlurb)}</span>` : ''}</li>`)
    .join('');
  const stories = guide.stories
    .map(
      (s) => `<section class="story" id="${s.anchor}" aria-labelledby="${s.anchor}-h">
  <header class="story-head">
    <p class="story-num">Walkthrough ${s.order}</p>
    <h2 id="${s.anchor}-h"><a class="anchor" href="#${s.anchor}" aria-label="Link to this walkthrough">#</a>${esc(s.title)}</h2>
    <p class="meta">Updated ${fmtDate(s.updatedAt)} ${verifiedBadge(s, repoUrl)}</p>
  </header>
  ${s.sentence ? `<blockquote class="user-story">${esc(s.sentence)}</blockquote>` : ''}
  ${s.benefitHtml ? `<aside class="benefit"><p class="benefit-h">Benefit</p>${s.benefitHtml}</aside>` : ''}
  <div class="prose">${s.html}</div>
  ${s.referenceHtml ? `<details class="reference"><summary>Setup, API and known limitations</summary><div class="prose">${s.referenceHtml}</div></details>` : ''}
</section>`,
    )
    .join('\n');
  return `<header class="guide-head">
  <h1>${esc(guide.title)}</h1>
  ${guide.introHtml ? `<div class="prose lede-block">${guide.introHtml}</div>` : `<p class="lede">${esc(guide.summary)}</p>`}
  ${guide.heroLocal ? `<figure class="guide-hero"><img src="${root}${esc(guide.heroLocal)}" alt="Screenshot from the ${esc(guide.title)} tutorial" decoding="async"></figure>` : ''}
  ${guide.benefitHtml ? `<aside class="benefit"><p class="benefit-h">Why this matters</p>${guide.benefitHtml}</aside>` : ''}
  <p class="meta">Last updated ${fmtDate(guide.updatedAt)} ${verifiedBadge(guide, repoUrl)}</p>
</header>
<section aria-labelledby="in-guide"><h2 id="in-guide" class="toc-h">In this tutorial</h2><ol class="toc">${toc}</ol></section>
${stories}`;
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
