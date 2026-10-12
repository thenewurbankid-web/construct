// Pure (DOMAIN-001): the Pages screen's chat (two modes, lib/lineModes.ts). Its levels are the URL's ?feature= and
// ?page= (a page's item id), the same parameters useLinePages reads, so a breadcrumb crumb opens the regular screen at
// exactly that feature or page. Static rules over the Line project the screen already reads.
import type { ChatAnswer, Place, ScreenChatProvider } from '../../../lib/lineModes.ts';
import type { LineProject, PageRow } from '../types.ts';
import { featureNames, featureSummary } from './FeatureList.ts';
import { featurePages, findPage } from './PageRows.ts';

const at = (place: Place, param: string) => place.steps.find((s) => s.param === param)?.id ?? null;
const pageIn = (project: LineProject, feature: string, id: string): PageRow | null => featurePages(project, feature).find((p) => p.id === id) ?? null;
const ENDS = /[.?!]$/;
const sentence = (text: string) => (ENDS.test(text) ? text : `${text}.`);
const tone = (problem: boolean) => (problem ? { tone: 'gap' as const, label: 'Needs attention' } : { tone: 'fit' as const, label: 'Fine' });

function pickFeature(project: LineProject): ChatAnswer {
  const items = featureNames(project).map((name) => ({ id: name, name, text: featureSummary(project, name), status: tone(featurePages(project, name).some((p) => p.status === 'problem')) }));
  if (!items.length) return { text: 'This project has no features yet.' };
  return { text: 'Which feature do you want to open?', pick: { label: 'Features', items } };
}

function pickPage(project: LineProject, feature: string): ChatAnswer {
  const pages = featurePages(project, feature);
  if (!pages.length) return { text: `${feature} has no pages yet.` };
  const items = pages.map((p) => ({ id: p.id, name: p.name, text: sentence(p.base.text), status: tone(p.status === 'problem') }));
  return { text: `Which page of ${feature} do you want to open?`, pick: { label: 'Pages', items } };
}

function attention(project: LineProject): ChatAnswer {
  const hits = featureNames(project).flatMap((f) => featurePages(project, f).filter((p) => p.status === 'problem').map((p) => ({ p, f })));
  if (!hits.length) return { text: 'No page needs attention.' };
  const head = hits.length === 1 ? 'One page needs attention' : `${hits.length} pages need attention`;
  const names = hits.map(({ p, f }) => `${p.name} in ${f}`).join(', ');
  return { text: [`${head}: ${names}.`, ...hits.flatMap(({ p }) => p.findings.map((x) => x.sentence))].join(' '), details: hits.flatMap(({ p }) => p.findings.map((x) => `${x.rule} ${x.file}:${x.line}`)) };
}

function pageAnswer(page: PageRow | null, feature: string, id: string): ChatAnswer {
  if (!page) return { text: `${id} is not a page of ${feature}.` };
  return { text: [`${page.name} is in feature ${feature}.`, sentence(page.base.text), ...page.findings.map((x) => x.sentence)].join(' '), details: [page.file, ...page.findings.map((x) => `${x.rule} ${x.file}:${x.line}`)] };
}

/** The Pages screen's chat provider: open a feature, then one of its pages; what needs attention; how to change a page. */
export const PAGES_CHAT: ScreenChatProvider<LineProject> = {
  screen: 'pages',
  label: 'Pages',
  href: '/pages',
  params: ['feature', 'page'],
  // The regular screen until the person picks Chat with the shell's switch.
  defaultMode: 'chat',
  labelOf: (param, id, project) => (param === 'page' ? (findPage(project, id)?.name ?? id) : id),
  options: (place) => {
    const feature = at(place, 'feature');
    const page = at(place, 'page');
    if (!feature) {
      return [
        { id: 'pages.open-feature', label: 'Open a feature', sentence: 'Pick a feature to see its pages.', effect: 'read' },
        { id: 'pages.attention', label: 'What needs attention?', sentence: 'Say which pages have a problem and why.', effect: 'read' },
      ];
    }
    if (!page) {
      return [
        { id: 'pages.open-page', label: 'Open a page', sentence: 'Pick a page of this feature to see its parts.', effect: 'read' },
        { id: 'pages.explain', label: 'Explain this feature', sentence: 'Say how many pages this feature has and how they are.', effect: 'read' },
      ];
    }
    return [
      { id: 'pages.explain', label: 'Explain this page', sentence: 'Say what this page is based on and whether it has a problem.', effect: 'read' },
      { id: 'pages.change', label: 'How do I change it?', sentence: 'Say how to change one prop or one piece of code on this page.', effect: 'read' },
    ];
  },
  answer: (optionId, place, project) => {
    const feature = at(place, 'feature');
    const page = at(place, 'page');
    if (optionId === 'pages.open-feature') return pickFeature(project);
    if (optionId === 'pages.attention') return attention(project);
    if (optionId === 'pages.open-page' && feature) return pickPage(project, feature);
    if (optionId === 'pages.explain' && feature && page) return pageAnswer(pageIn(project, feature, page), feature, page);
    if (optionId === 'pages.explain' && feature) return { text: `${feature}: ${featureSummary(project, feature)}` };
    if (optionId === 'pages.change' && feature && page) {
      const name = pageIn(project, feature, page)?.name ?? page;
      return { text: `Pick a part of ${name} beside this chat and change one prop, or use Edit code for one piece of code. Each Save waits in the plan for your approval.` };
    }
    return null;
  },
  intro: (place, project) => {
    const feature = at(place, 'feature');
    const page = at(place, 'page');
    if (!feature) return { text: 'What do you want to do with your pages?' };
    if (!page) return { text: `${feature} is open. ${featureSummary(project, feature)}` };
    const row = pageIn(project, feature, page);
    return { text: row ? `${row.name} is open. ${sentence(row.base.text)}` : `${page} is not a page of ${feature}.` };
  },
};
