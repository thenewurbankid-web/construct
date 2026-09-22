// Board taxonomy: Module -> Sub-module. Area is always derived as "<Module> › <Sub-module>"
// (Projects v2 views group by ONE field only, so Area gives the two-level look).
export const OTHER = 'Other';

export const TAXONOMY = {
  'Core CLI': ['Config & framework support', 'AST & parsing', 'Enforcers', 'Import', 'Research & narrator', 'CLI shell & build', OTHER],
  'Web UI': ['Dashboard', 'Import Wizard', 'Pages Editor', 'Visual composer', 'Workflows screen', 'Settings & Local model', 'Help & Tutorials', 'Design system', OTHER],
  'AI Toolkit': ['Ollama & models', 'Provider routing', 'LLM fill safety', OTHER],
  'Pipeline & Generators': ['Envelope engine', 'Workflows (XState)', 'Generators', 'Frozen presentation', OTHER],
  'Demos & Docs': ['Guides', 'Tutorials', 'Screenshots', 'Style guide', OTHER],
  'Infra & Process': ['CI & e2e', 'Security', 'Dependencies', 'Project board', 'Comment bridge', OTHER],
};

export const MODULES = Object.keys(TAXONOMY);
export const SUB_MODULES = [...new Set(Object.values(TAXONOMY).flat())]; // "Other" is shared
export const areaOf = (module, sub) => `${module} › ${sub}`;
export const AREAS = MODULES.flatMap(m => TAXONOMY[m].map(s => areaOf(m, s)));

// null = consistent; otherwise a short reason string.
export function checkArea({ module, subModule, area }) {
  if (!module || !subModule) return null; // reported separately as "missing"
  if (!TAXONOMY[module]?.includes(subModule)) return `Sub-module "${subModule}" does not belong to Module "${module}"`;
  return area === areaOf(module, subModule) ? null : `Area is ${area ? `"${area}"` : 'unset'}, expected "${areaOf(module, subModule)}"`;
}
