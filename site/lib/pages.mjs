// Page templates: pure functions from data to HTML strings. No I/O.
import { esc } from './text.mjs';

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230b0d12'/%3E%3Cpath d='M9 9h14v4H13v6h10v4H9z' fill='%235b8cff'/%3E%3C/svg%3E";

const fmtDate = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

function layout({ title, description, root, body, sidebar = '', active = '', repoUrl, canonical, ogImage, basePath }) {
  const nav = [
    ['', 'Guides', 'guides'],
    ['try-it.html', 'Try it', 'try'],
  ]
    .map(([href, label, key]) => `<a href="${href ? root + href : root || './'}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`)
    .join('');
  const fullTitle = title === 'Construct User Guide' ? title : `${esc(title)} · Construct User Guide`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="dark light">
<meta property="og:type" content="website">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${esc(description)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
<link rel="icon" href="${FAVICON}">
${basePath ? `<base href="${esc(basePath)}">` : ''}
<link rel="stylesheet" href="${root}assets/css/site.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="${root || './'}"><span class="brand-mark" aria-hidden="true">C</span><span>Construct</span><span class="brand-sub">User Guide</span></a>
    <nav aria-label="Primary">${nav}<a class="ext" href="${esc(repoUrl)}">GitHub</a></nav>
  </div>
</header>
<div class="shell${sidebar ? ' has-sidebar' : ''}">
${sidebar ? `<aside class="sidebar" aria-label="Guide navigation">${sidebar}</aside>` : ''}
<main id="main" tabindex="-1">
${body}
</main>
</div>
<footer class="footer"><div class="footer-inner">
<span>Generated from the <a href="${esc(repoUrl)}/issues/125">Demos tickets</a> on GitHub. Built <time datetime="__BUILD__">__BUILD_DATE__</time>.</span>
<a href="${esc(repoUrl)}">Source on GitHub</a>
</div></footer>
</body>
</html>
`;
}

const guideHref = (root, g) => `${root}guides/${g.slug}/`;

function verifiedBadge(story, repoUrl) {
  return story.verified
    ? `<span class="badge" title="Demo verified against this commit">verified on <a href="${esc(repoUrl)}/commit/${esc(story.verified)}"><code>${esc(story.verified.slice(0, 7))}</code></a></span>`
    : '';
}

export function renderHome({ guides, repoUrl, buildTime, basePath, siteUrl }) {
  const stories = guides.reduce((n, g) => n + g.stories.length, 0);
  const cards = guides
    .map(
      (g) => `<article class="card">
  ${g.hero ? `<a class="card-media" href="${guideHref('', g)}" tabindex="-1" aria-hidden="true"><img src="${esc(g.heroLocal || g.hero)}" alt="" loading="lazy" decoding="async"></a>` : ''}
  <div class="card-body">
    <h3><a href="${guideHref('', g)}">${esc(g.title)}</a></h3>
    <p>${esc(g.summary)}</p>
    <p class="meta">${g.stories.length} ${g.stories.length === 1 ? 'walkthrough' : 'walkthroughs'} · updated ${fmtDate(g.updatedAt)}</p>
  </div>
</article>`,
    )
    .join('\n');
  const body = `<section class="hero">
  <p class="eyebrow">User guide</p>
  <h1>Build and refactor web apps with deterministic blocks, not guesswork.</h1>
  <p class="lede">Construct is a library of small, code-driven building blocks that scaffold, import and validate a React + TypeScript app against rules your project defines. You drive them from the command line or the Cockpit UI, and an LLM only steps in where a deterministic block genuinely cannot.</p>
  <ul class="pillars">
    <li><strong>Cockpit, not autopilot.</strong> See what is being built and correct it in a few clicks.</li>
    <li><strong>One machinery for humans and LLMs.</strong> The same blocks run whether you click, script or delegate.</li>
    <li><strong>Examples over instructions.</strong> Each layer hands the next a concrete example to follow.</li>
  </ul>
  <p class="cta"><a class="btn primary" href="#guides">Browse the guides</a><a class="btn" href="try-it.html">Try it yourself</a></p>
</section>
<section id="guides" aria-labelledby="guides-h">
  <h2 id="guides-h">Guides</h2>
  <p class="section-note">${guides.length} guides, ${stories} walkthroughs. Every walkthrough shows real command-line output and real screenshots from the Cockpit UI.</p>
  <div class="cards">
${cards}
  </div>
</section>`;
  return finish(layout({ title: 'Construct User Guide', description: 'Step-by-step guides for Construct: scaffold, import and validate React + TypeScript apps from the command line or the Cockpit UI.', root: '', body, active: 'guides', repoUrl, canonical: siteUrl }), buildTime);
}

export function renderGuide({ guide, guides, repoUrl, buildTime, siteUrl }) {
  const root = '../../';
  const sidebar = `<nav aria-label="Guides">
  <p class="side-h">Guides</p>
  <ul class="side-guides">${guides
    .map((g) => `<li${g.number === guide.number ? ' class="current"' : ''}><a href="${guideHref(root, g)}"${g.number === guide.number ? ' aria-current="page"' : ''}>${esc(g.title)}</a></li>`)
    .join('')}</ul>
  <p class="side-h">On this page</p>
  <ol class="side-toc">${guide.stories.map((s) => `<li><a href="#${s.anchor}">${esc(s.title)}</a></li>`).join('')}</ol>
</nav>`;
  const toc = guide.stories
    .map((s) => `<li><a href="#${s.anchor}">${esc(s.title)}</a>${s.summary ? `<span>${esc(s.summary)}</span>` : ''}</li>`)
    .join('');
  const stories = guide.stories
    .map(
      (s) => `<section class="story" id="${s.anchor}" aria-labelledby="${s.anchor}-h">
  <header class="story-head">
    <p class="story-num">Walkthrough ${s.order}</p>
    <h2 id="${s.anchor}-h"><a class="anchor" href="#${s.anchor}" aria-label="Link to this walkthrough">#</a>${esc(s.title)}</h2>
    <p class="meta">Updated ${fmtDate(s.updatedAt)} ${verifiedBadge(s, repoUrl)} <a href="${esc(s.url)}">View on GitHub</a></p>
  </header>
  ${s.benefitHtml ? `<aside class="benefit"><p class="benefit-h">Why it matters</p>${s.benefitHtml}</aside>` : ''}
  <div class="prose">${s.html}</div>
  ${s.referenceHtml ? `<details class="reference"><summary>Setup, API and known limitations</summary><div class="prose">${s.referenceHtml}</div></details>` : ''}
</section>`,
    )
    .join('\n');
  const body = `<nav class="crumbs" aria-label="Breadcrumb"><a href="${root}">Guides</a> <span aria-hidden="true">/</span> <span>${esc(guide.title)}</span></nav>
<header class="guide-head">
  <h1>${esc(guide.title)}</h1>
  ${guide.introHtml ? `<div class="prose lede-block">${guide.introHtml}</div>` : `<p class="lede">${esc(guide.summary)}</p>`}
  ${guide.benefitHtml ? `<aside class="benefit"><p class="benefit-h">Why it matters</p>${guide.benefitHtml}</aside>` : ''}
  <p class="meta">Last updated ${fmtDate(guide.updatedAt)} · <a href="${esc(guide.url)}">View guide on GitHub</a></p>
</header>
<section aria-labelledby="in-guide"><h2 id="in-guide" class="toc-h">In this guide</h2><ol class="toc">${toc}</ol></section>
${stories}`;
  return finish(layout({ title: guide.title, description: guide.summary || guide.title, root, body, sidebar, active: 'guides', repoUrl, canonical: siteUrl ? `${siteUrl}guides/${guide.slug}/` : '', ogImage: guide.heroAbs }), buildTime);
}

export function renderTryIt({ repoUrl, buildTime, siteUrl }) {
  const body = `<header class="guide-head"><h1>Try it</h1><p class="lede">Construct runs from a checkout of the repository. You need Node.js 22 or newer.</p></header>
<div class="prose">
<h2 id="install">Install</h2>
<pre><code>git clone ${esc(repoUrl)}.git
cd construct
npm install
npm link</code></pre>
<h2 id="first-project">Create your first project</h2>
<pre><code>construct init my-app
construct create feature billing --dir my-app
construct validate --dir my-app</code></pre>
<p>Each command prints what it did, and how many LLM calls it made (zero, unless you asked for one).</p>
<h2 id="cockpit">Open the Cockpit UI</h2>
<pre><code>cd ui/server &amp;&amp; npm install &amp;&amp; npm start     # terminal 1, port 4000
cd ui/client &amp;&amp; npm install &amp;&amp; npm run dev   # terminal 2, port 3000</code></pre>
<p>Then open <code>http://localhost:3000</code>. The guides on this site walk through both surfaces side by side.</p>
<h2 id="more">More</h2>
<p>The <a href="${esc(repoUrl)}#readme">README</a> covers the full command reference, the seven-layer feature architecture and the <code>architecture.yml</code> policy file.</p>
</div>`;
  return finish(layout({ title: 'Try it', description: 'Install Construct and run your first commands.', root: '', body, active: 'try', repoUrl, canonical: siteUrl ? `${siteUrl}try-it.html` : '' }), buildTime);
}

export function render404({ repoUrl, buildTime, basePath }) {
  const body = `<div class="notfound"><p class="eyebrow">404</p><h1>That page does not exist.</h1><p class="lede">The guide may have been renamed or removed.</p><p class="cta"><a class="btn primary" href="${esc(basePath || './')}">Back to the guides</a></p></div>`;
  return finish(layout({ title: 'Page not found', description: 'Page not found.', root: '', body, repoUrl, basePath }), buildTime);
}

function finish(html, buildTime) {
  return html.replaceAll('__BUILD__', new Date(buildTime).toISOString()).replaceAll('__BUILD_DATE__', fmtDate(buildTime) + ' UTC');
}
