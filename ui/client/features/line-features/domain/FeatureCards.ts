import type { FeatureCard, LineProject } from '../types';

const itemsText = (n: number) => (n === 1 ? 'One item' : `${n} items`);

/** One card per feature: "All fine" when no item has a finding, else "Needs attention", with a count in words. */
export function featureCards(project: LineProject): FeatureCard[] {
  return project.features.map((f) => {
    const problems = f.items.filter((i) => i.status === 'problem').length;
    if (f.items.length === 0) return { name: f.name, ok: true, status: 'All fine', text: 'Nothing in it yet.' };
    if (problems === 0) return { name: f.name, ok: true, status: 'All fine', text: `${itemsText(f.items.length)}, all fine.` };
    const need = problems === 1 ? 'one needs' : `${problems} need`;
    return { name: f.name, ok: false, status: 'Needs attention', text: `${itemsText(f.items.length)}, ${need} attention.` };
  });
}
