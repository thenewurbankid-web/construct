// Markdown -> HTML for the documentation pages. Pure aside from reading repo files for includes/links.
//
// Docs are reused from the repository at build time (README.md, docs/*.md, packages/ast/README.md) rather than
// copied, so the site cannot drift from them. Two helpers make that practical:
//   - {{include path#Heading level=N}}   pulls one section of a repo markdown file into an authored page
//   - relative links inside reused files are rewritten to site pages when one exists, else to GitHub
import fs from 'node:fs';
import path from 'node:path';
import { Marked } from 'marked';
import { sanitizeHtml } from './sanitize.mjs';
import { makeSlugger, esc } from './text.mjs';

const FENCE = /^\s*(```|~~~)/;

/** Split markdown into lines paired with "inside a fenced code block" so heading scans ignore `# comments`. */
function scan(md) {
  let fence = null;
  return md.split('\n').map((line) => {
    const m = FENCE.exec(line);
    if (m) {
      if (!fence) fence = m[1];
      else if (m[1] === fence) {
        fence = null;
        return { line, code: true };
      }
    }
    return { line, code: fence !== null };
  });
}

/** Return the section that starts at `heading` (exact text) through the next heading of the same or higher level. */
export function extractSection(md, heading) {
  const rows = scan(md);
  let start = -1;
  let level = 0;
  for (let i = 0; i < rows.length; i++) {
    const m = !rows[i].code && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(rows[i].line);
    if (m && m[2].replace(/[`*]/g, '') === heading) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  if (start < 0) throw new Error(`section "${heading}" not found`);
  let end = rows.length;
  for (let i = start + 1; i < rows.length; i++) {
    const m = !rows[i].code && /^(#{1,6})\s/.exec(rows[i].line);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return { markdown: rows.slice(start, end).map((r) => r.line).join('\n'), level };
}

/** Re-level every heading so the first one becomes `top`; `dropFirst` removes the first heading line. */
export function relevel(md, top, dropFirst = false) {
  const rows = scan(md);
  const first = rows.find((r) => !r.code && /^#{1,6}\s/.test(r.line));
  if (!first) return md;
  const base = /^(#+)/.exec(first.line)[1].length;
  const out = [];
  let dropped = false;
  for (const r of rows) {
    const m = !r.code && /^(#{1,6})(\s.*)$/.exec(r.line);
    if (!m) {
      out.push(r.line);
      continue;
    }
    if (dropFirst && !dropped) {
      dropped = true;
      continue;
    }
    out.push('#'.repeat(Math.min(6, Math.max(1, m[1].length - base + top))) + m[2]);
  }
  return out.join('\n');
}

/** Expand `{{include file#Heading level=N nohead}}` lines. Paths are repo-relative. */
export function expandIncludes(md, repoRoot) {
  return md.replace(/^\{\{include\s+([^\s#}]+)(?:#([^}]*?))?(?:\s+level=(\d))?(\s+nohead)?\s*\}\}\s*$/gm, (_, file, heading, level, nohead) => {
    const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    if (!heading) return level ? relevel(text, Number(level), !!nohead) : text;
    const { markdown } = extractSection(text, heading.trim());
    return relevel(markdown, Number(level || 2), !!nohead);
  });
}

/** Remove tracker plumbing ("(#96)", "Epic 6.4/#100", "Tracked under issue #104") that means nothing to a reader. */
export function stripTicketRefs(md) {
  return md
    .replace(/\s*\((?:see |Part of |Tickets? |Ticket )?(?:#\d+|Epic \d)[^)]*\)/g, '')
    .replace(/\s*Tracked under issue #\d+\.?/g, '')
    .replace(/ #\d{2,4}\b/g, (m, off, s) => (/(?:issue|ticket|PR)s?\s*$/i.test(s.slice(0, off)) ? '' : m));
}

/** Drop tracker numbers from already-rendered guide HTML (tables of "#128" cells, "Part of #127" lines). */
export function stripTicketRefsHtml(html) {
  let out = String(html);
  // A contents table whose first column is just issue numbers: drop that column.
  out = out.replace(/<table[\s\S]*?<\/table>/g, (table) => {
    const head = /<tr[^>]*>\s*<th[^>]*>\s*#\s*<\/th>/i.test(table);
    if (!head) return table;
    return table.replace(/<(th|td)[^>]*>\s*(?:#|<a[^>]*>\s*#\d+\s*<\/a>|#\d+)\s*<\/\1>\s*/g, '');
  });
  const parts = out.split(/(<[^>]+>)/);
  let inCode = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith('<')) {
      if (/^<(pre|code)\b/i.test(p)) inCode++;
      if (/^<\/(pre|code)>/i.test(p)) inCode = Math.max(0, inCode - 1);
      continue;
    }
    if (inCode) continue;
    parts[i] = p.replace(/\s*\((?:Demos? epic |Part of |see )?#\d+[^)]*\)/gi, '').replace(/\bPart of #\d+\.?/g, '');
  }
  return parts.join('').replace(/<p>\s*<\/p>/g, '');
}

/**
 * Render markdown to HTML.
 * ctx: { repoRoot, repoUrl, source (repo-relative file this text came from, for relative links),
 *        resolvePage(repoPath) -> site href | null, branch }
 * Returns { html, headings: [{level,id,text}] }.
 */
export function renderMarkdown(md, ctx) {
  const { repoRoot, repoUrl, source = '', resolvePage = () => null, branch = 'main', root = '' } = ctx;
  const text = stripTicketRefs(expandIncludes(md, repoRoot));
  const links = [];
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    walkTokens(token) {
      if (token.type === 'link') links.push(token);
    },
  });
  let html = marked.parse(text);

  // Headings: ids, anchors, table of contents.
  const slug = makeSlugger();
  const headings = [];
  html = html.replace(/<h([1-4])>([\s\S]*?)<\/h\1>/g, (_, lvl, inner) => {
    const plain = inner.replace(/<[^>]+>/g, '');
    const id = slug(plain);
    headings.push({ level: Number(lvl), id, text: plain.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") });
    return `<h${lvl} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${lvl}>`;
  });

  // Site images: ![alt](@img/name.webp) points at site/assets/img/name.webp.
  html = html.replace(/<img src="@img\/([^"]+)"/g, (_, f) => `<img src="${root}assets/img/${f}" loading="lazy" decoding="async"`);

  // Site videos: ![alt](@video/name) points at site/assets/video/name.webm, with name.png as its poster.
  html = html.replace(/(?:<p>)?<img src="@video\/([^"]+)"(?: alt="([^"]*)")?[^>]*>(?:<\/p>)?/g, (_, f, alt = '') => `<figure class="video"><video controls preload="metadata" width="1280" height="720" poster="${root}assets/video/${f}.png" aria-label="${alt}"><source src="${root}assets/video/${f}.webm" type="video/webm"><a href="@assets/video/${f}.webm" download>Download the video</a></video><figcaption><a href="@assets/video/${f}.webm" download>Download the video (.webm)</a></figcaption></figure>`);

  const ids = new Set(headings.map((h) => h.id));
  const srcDir = path.posix.dirname(source || '.');
  const blob = (p, dir) => `${repoUrl}/${dir ? 'tree' : 'blob'}/${branch}/${p}`;

  html = html.replace(/<a href="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/g, (whole, href, rest, inner) => {
    if (/^(https?:|mailto:)/.test(href)) return `<a href="${href}"${rest} rel="noopener">${inner}</a>`;
    if (href.startsWith('@')) return `<a href="${root}${href.slice(1)}"${rest}>${inner}</a>`; // site-internal page path
    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1));
      return ids.has(id) ? whole : `<a href="${blob(source, false)}${href}">${inner}</a>`;
    }
    const [target, frag = ''] = href.split('#');
    const repoPath = path.posix.normalize(target.startsWith('/') ? target.slice(1) : path.posix.join(srcDir, target)).replace(/\/$/, '');
    const page = resolvePage(repoPath);
    if (page) return `<a href="${page}${frag ? '#' + frag : ''}">${inner}</a>`;
    const abs = path.join(repoRoot, repoPath);
    if (fs.existsSync(abs)) return `<a href="${blob(repoPath, fs.statSync(abs).isDirectory())}${frag ? '#' + frag : ''}"${rest} rel="noopener">${inner}</a>`;
    return inner; // dead link in the source: keep the words, drop the link
  });

  return { html: sanitizeHtml(html), headings };
}

export { esc };
