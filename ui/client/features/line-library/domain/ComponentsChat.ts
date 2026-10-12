// Pure (DOMAIN-001): the Components screen's chat (two modes, lib/lineModes.ts). Its levels are the URL's ?feature= and
// ?component=, the same parameters Under the hood reads to select a feature and its component, so a breadcrumb crumb
// opens the regular screen at exactly that place. Static rules over the LibraryView the screen already renders.
import type { ChatAnswer, Place, ScreenChatProvider } from '../../../lib/lineModes.ts';
import { namedItems } from '../../../lib/lineModes.ts';
import type { FeatureComponentRow, FeatureSection, LibraryView } from '../types.ts';

const at = (place: Place, param: string) => place.steps.find((s) => s.param === param)?.id ?? null;
const featureOf = (view: LibraryView, name: string | null): FeatureSection | null => view.features.find((f) => f.name === name) ?? null;
const rowOf = (section: FeatureSection | null, name: string | null): FeatureComponentRow | null => section?.rows.find((r) => r.name === name) ?? null;
const count = (n: number) => (n === 1 ? 'One component' : `${n} components`);

/** What Under the hood selects from the URL: the feature and its component (null when not set). */
export function componentPlace(search: string): { feature: string | null; component: string | null } {
  const q = new URLSearchParams(search);
  const feature = q.get('feature') || null;
  return { feature, component: feature ? q.get('component') || null : null };
}

function libraryAnswer(view: LibraryView): ChatAnswer {
  if (!view.total) return { text: 'The library has no components yet.' };
  const groups = view.groups.map((g) => `${g.title}: ${g.cards.map((c) => c.name).join(', ')}.`);
  return { text: [`The library has ${count(view.total).toLowerCase()}.`, ...groups].join(' '), details: view.groups.flatMap((g) => g.cards.map((c) => c.file)) };
}

function featureAnswer(section: FeatureSection | null, name: string): ChatAnswer {
  if (!section) return { text: `${name} has no components of its own.` };
  return { text: `${name} has ${count(section.rows.length).toLowerCase()}: ${section.rows.map((r) => r.name).join(', ')}.` };
}

function componentAnswer(row: FeatureComponentRow | null, feature: string, name: string): ChatAnswer {
  if (!row) return { text: `${name} is not a component of ${feature}.` };
  const findings = row.findings.map((f) => f.sentence);
  return { text: [`${row.name} is in feature ${feature}.`, `${row.baseText}.`, ...findings].join(' '), details: [row.file, ...row.findings.map((f) => `${f.rule} ${f.file}:${f.line}`)] };
}

function pickFeature(view: LibraryView): ChatAnswer {
  const items = view.features.map((f) => ({ id: f.name, name: f.name, text: `${count(f.rows.length)}.`, status: f.rows.some((r) => r.problem) ? { tone: 'gap' as const, label: 'Needs attention' } : { tone: 'fit' as const, label: 'Fine' } }));
  return { text: 'Which feature do you want to open?', pick: { label: 'Features', items } };
}

function pickComponent(section: FeatureSection | null, feature: string): ChatAnswer {
  const rows = section?.rows ?? [];
  if (!rows.length) return { text: `${feature} has no components of its own.` };
  const items = namedItems(rows.map((r) => r.name), (n) => `${rows.find((r) => r.name === n)?.baseText ?? ''}.`).map((it) => {
    const problem = rows.find((r) => r.name === it.id)?.problem;
    return { ...it, status: problem ? { tone: 'gap' as const, label: 'Needs attention' } : { tone: 'fit' as const, label: 'Fine' } };
  });
  return { text: `Which component of ${feature} do you want to open?`, pick: { label: 'Components', items } };
}

/** The Components screen's chat provider: open a feature, then one of its components; the library by level; Promote. */
export const COMPONENTS_CHAT: ScreenChatProvider<LibraryView> = {
  screen: 'components',
  label: 'Components',
  href: '/components',
  params: ['feature', 'component'],
  // The regular screen until the person picks Chat with the shell's switch.
  defaultMode: 'chat',
  options: (place, view) => {
    const feature = at(place, 'feature');
    const component = at(place, 'component');
    if (!feature) {
      const none = view.features.length ? {} : { disabled: 'No feature has its own components yet.' };
      return [
        { id: 'components.open-feature', label: 'Open a feature', sentence: 'Pick a feature to see its own components.', effect: 'read', ...none },
        { id: 'components.library', label: 'What is in the library?', sentence: 'Say which components the library has, by level.', effect: 'read' },
      ];
    }
    if (!component) {
      return [
        { id: 'components.open-component', label: 'Open a component', sentence: 'Pick a component of this feature to see what it is based on.', effect: 'read' },
        { id: 'components.explain', label: 'Explain this feature', sentence: 'Say which components this feature has.', effect: 'read' },
      ];
    }
    const row = rowOf(featureOf(view, feature), component);
    const locked = row?.readOnly ? { disabled: 'This component is outside your workspace folder, so Line will not change it.' } : row ? {} : { disabled: 'This component is not in the project.' };
    return [
      { id: 'components.explain', label: 'Explain this component', sentence: 'Say what this component is based on and whether it has a problem.', effect: 'read' },
      { id: 'components.promote', label: 'Promote to library', sentence: 'Move this component into the library; the change waits in the plan for your approval.', effect: 'plan', ...locked },
    ];
  },
  answer: (optionId, place, view) => {
    const feature = at(place, 'feature');
    const component = at(place, 'component');
    const section = featureOf(view, feature);
    if (optionId === 'components.open-feature') return pickFeature(view);
    if (optionId === 'components.library') return libraryAnswer(view);
    if (optionId === 'components.open-component' && feature) return pickComponent(section, feature);
    if (optionId === 'components.explain' && feature && component) return componentAnswer(rowOf(section, component), feature, component);
    if (optionId === 'components.explain' && feature) return featureAnswer(section, feature);
    return null;
  },
  intro: (place, view) => {
    const feature = at(place, 'feature');
    const component = at(place, 'component');
    if (!feature) return { text: 'What do you want to do with your components?' };
    if (!component) return { text: `${feature} is open.` };
    const row = rowOf(featureOf(view, feature), component);
    return { text: row ? `${component} is open. ${row.baseText}.` : `${component} is not a component of ${feature}.` };
  },
};
