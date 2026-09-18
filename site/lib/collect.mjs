// Turn a data source into { guides: [{ ..., stories: [...] }] }.
// Primary: real GitHub sub-issues of the Demos epic (guides) and of each guide (stories).
// Fallback: `[Demo...]` issues grouped by their "Part of #N" body line.
import { parsePartOf, parseStoryBody, parseDemoBody, stripComments, firstParagraph, splitReference, shiftHeadings, addHeadingIds } from './story.mjs';
import { cleanTitle, makeSlugger, slugify, isDemoTitle, plainSummary } from './text.mjs';
import { sanitizeHtml } from './sanitize.mjs';
import { firstMarkdownImage } from './images.mjs';

export const SUPERSEDED = /\bsuperseded\b/i;

/** Closed demos only; skip superseded ones and open-and-empty ones. */
export function isPublishable(issue, comments = []) {
  if (issue.state !== 'closed') return false;
  if (!issue.body || issue.body.trim().length < 40) return false;
  const closing = [...comments].reverse().slice(0, 3);
  return !closing.some((c) => SUPERSEDED.test((c.body || '').slice(0, 200)));
}

const renderSafe = async (source, md) => (md ? sanitizeHtml(await source.render(md).catch(() => '')) : '');
const hasEvidence = (md) => /```|!\[/.test(md || '');
const BOILERPLATE = /^\s*(?:Parent\/tracking ticket|Part of\s+#\d+)/i;

/** Drop leading bookkeeping paragraphs ("Part of #N ...", "Parent/tracking ticket ..."). */
export function dropBoilerplate(md) {
  const paras = String(md).split(/\n\s*\n/);
  while (paras.length && BOILERPLATE.test(paras[0])) paras.shift();
  return paras.join('\n\n').trim();
}

/** For new-shape stories whose body has no walkthrough, use the write-up comment that carries evidence. */
function writeupFromComments(comments) {
  const c = comments
    .map((x) => stripComments(x.body || ''))
    .filter((b) => b.length > 1500 && hasEvidence(b))
    .sort((a, b) => b.length - a.length)[0];
  return c || '';
}

async function buildStory(source, issue, guideNumber, order, skipped, contents = {}) {
  const comments = await source.comments(issue.number);
  if (!isPublishable(issue, comments)) {
    skipped.push({ number: issue.number, reason: issue.state !== 'closed' ? 'not closed' : 'superseded or empty' });
    return null;
  }
  const v1 = parseDemoBody(issue.body);
  let markdown, benefitMd, verified, verifiedDate = null, sentence = '', summary;
  if (v1) {
    markdown = dropBoilerplate(hasEvidence(v1.legacy) ? v1.legacy : writeupFromComments(comments));
    benefitMd = v1.benefit;
    verified = v1.verified;
    verifiedDate = v1.verifiedDate;
    sentence = v1.sentence;
    summary = plainSummary(v1.sentence || contents[issue.number]?.story || '');
  } else {
    const p = parseStoryBody(issue.body);
    markdown = p.markdown;
    benefitMd = p.benefit;
    verified = p.verified;
    summary = firstParagraph(markdown);
  }
  let html;
  try {
    html = await source.render(markdown);
  } catch (e) {
    skipped.push({ number: issue.number, reason: `render failed: ${e.message}` });
    return null;
  }
  const slug = `${issue.number}-${slugify(cleanTitle(issue.title))}`.slice(0, 70).replace(/-+$/, '');
  html = addHeadingIds(shiftHeadings(sanitizeHtml(html), 1), `s${issue.number}`, makeSlugger());
  const { main, reference } = splitReference(html);
  return {
    number: issue.number,
    order,
    guide: guideNumber,
    title: cleanTitle(issue.title),
    url: issue.html_url,
    updatedAt: issue.updated_at,
    anchor: slug,
    verified,
    verifiedDate,
    sentence,
    benefitHtml: await renderSafe(source, benefitMd),
    summary,
    tocBlurb: contents[issue.number]?.benefit || '',
    hero: firstMarkdownImage(stripComments(issue.body)),
    html: main,
    referenceHtml: reference,
  };
}

async function buildGuide(source, epic, storyIssues, skipped) {
  const v1 = parseDemoBody(epic.body);
  let introMd, whyMd = '', evidenceMd = '', hero, verified = null, verifiedDate = null, summary, contents = {};
  if (v1) {
    introMd = [v1.who && `**Who it is for:** ${v1.who}`, v1.problem && `**The problem it solves:** ${v1.problem}`].filter(Boolean).join('\n\n');
    whyMd = v1.why;
    evidenceMd = v1.evidence;
    hero = v1.hero;
    verified = v1.verified;
    verifiedDate = v1.verifiedDate;
    contents = v1.contents;
    summary = plainSummary(v1.why.split('\n').join(' '), 170) || plainSummary(v1.problem, 170);
  } else {
    // Old shape: only the plain "What this demonstrates" text, never ticket boilerplate.
    const { markdown } = parseStoryBody(epic.body);
    const intro = /(?:^|\n)##\s+What this demonstrates\s*\n([\s\S]*?)(?=\n##\s|(?![\s\S]))/i.exec(markdown);
    introMd = dropBoilerplate((intro ? intro[1] : markdown.split(/\n##\s/)[0]).trim());
    summary = firstParagraph(introMd);
  }
  const stories = [];
  let order = 1;
  for (const s of storyIssues) {
    const st = await buildStory(source, s, epic.number, order, skipped, contents);
    if (st) {
      stories.push(st);
      order++;
    }
  }
  hero = hero || stories.map((s) => s.hero).find(Boolean) || firstMarkdownImage(stripComments(epic.body)) || null;
  return {
    number: epic.number,
    title: cleanTitle(epic.title),
    slug: `${epic.number}-${slugify(cleanTitle(epic.title))}`.slice(0, 60).replace(/-+$/, ''),
    url: epic.html_url,
    updatedAt: [epic.updated_at, ...stories.map((s) => s.updatedAt)].sort().pop(),
    summary: summary || stories[0]?.summary || '',
    introHtml: await renderSafe(source, introMd),
    benefitHtml: await renderSafe(source, [whyMd, evidenceMd].filter(Boolean).join('\n\n')),
    verified,
    verifiedDate,
    hero,
    stories,
  };
}

export async function collectGuides(source, { epicNumber = 125 } = {}) {
  const skipped = [];
  let guideIssues = await source.subIssues(epicNumber);
  let mode = 'sub-issues';
  let all = null;
  const allDemos = async () => (all ??= await source.demoIssues());
  if (!guideIssues.length) {
    // Fallback: guides are demo issues filed directly under the epic; stories group by "Part of #N".
    mode = 'part-of-fallback';
    guideIssues = (await allDemos()).filter((i) => isDemoTitle(i.title) && parsePartOf(i.body) === epicNumber);
  }
  const guides = [];
  for (const g of guideIssues) {
    if (g.state !== 'closed') {
      skipped.push({ number: g.number, reason: 'guide not closed' });
      continue;
    }
    let kids = await source.subIssues(g.number);
    if (!kids.length) kids = (await allDemos()).filter((i) => parsePartOf(i.body) === g.number && i.number !== g.number);
    if (!kids.length) kids = [g]; // a standalone demo is a one-story guide
    const guide = await buildGuide(source, g, kids, skipped);
    if (guide.stories.length) guides.push(guide);
    else skipped.push({ number: g.number, reason: 'no publishable stories' });
  }
  guides.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)); // newest content first
  return { guides, skipped, mode };
}
