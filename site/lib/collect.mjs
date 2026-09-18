// Turn a data source into { guides: [{ ..., stories: [...] }] }.
// Primary: real GitHub sub-issues of the Demos epic (guides) and of each guide (stories).
// Fallback: `[Demo...]` issues grouped by their "Part of #N" body line.
import { parsePartOf, parseStoryBody, firstParagraph, splitReference, shiftHeadings, addHeadingIds } from './story.mjs';
import { cleanTitle, makeSlugger, slugify, isDemoTitle } from './text.mjs';
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

async function buildStory(source, issue, guideNumber, order, skipped) {
  const comments = await source.comments(issue.number).catch(() => []);
  if (!isPublishable(issue, comments)) {
    skipped.push({ number: issue.number, reason: issue.state !== 'closed' ? 'not closed' : 'superseded or empty' });
    return null;
  }
  const { markdown, benefit, verified } = parseStoryBody(issue.body);
  let html;
  try {
    html = await source.render(markdown);
  } catch (e) {
    skipped.push({ number: issue.number, reason: `render failed: ${e.message}` });
    return null;
  }
  const benefitHtml = benefit ? await source.render(benefit).catch(() => '') : '';
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
    benefitHtml: sanitizeHtml(benefitHtml),
    summary: firstParagraph(markdown),
    hero: firstMarkdownImage(issue.body),
    html: main,
    referenceHtml: reference,
  };
}

async function buildGuide(source, epic, storyIssues, skipped) {
  const { markdown, benefit } = parseStoryBody(epic.body);
  const intro = /^##\s+What this demonstrates\s*\n([\s\S]*?)(?=\n##\s|$)/im.exec(markdown);
  const introMd = (intro ? intro[1] : markdown.split(/\n##\s/)[0]).trim();
  const stories = [];
  let order = 1;
  for (const s of storyIssues) {
    const st = await buildStory(source, s, epic.number, order, skipped);
    if (st) {
      stories.push(st);
      order++;
    }
  }
  const hero = stories.map((s) => s.hero).find(Boolean) || firstMarkdownImage(epic.body) || null;
  return {
    number: epic.number,
    title: cleanTitle(epic.title),
    slug: `${epic.number}-${slugify(cleanTitle(epic.title))}`.slice(0, 60).replace(/-+$/, ''),
    url: epic.html_url,
    updatedAt: [epic.updated_at, ...stories.map((s) => s.updatedAt)].sort().pop(),
    summary: firstParagraph(introMd) || stories[0]?.summary || '',
    introHtml: introMd ? sanitizeHtml(await source.render(introMd).catch(() => '')) : '',
    benefitHtml: benefit ? sanitizeHtml(await source.render(benefit).catch(() => '')) : '',
    hero,
    stories,
  };
}

export async function collectGuides(source, { epicNumber = 125 } = {}) {
  const skipped = [];
  let guideIssues = await source.subIssues(epicNumber);
  let mode = 'sub-issues';
  let all = null;
  const allDemos = async () => (all ??= await source.demoIssues().catch(() => []));
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
