import type { LineWorkflowList, WorkflowCard } from '../types';

const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One card per feature workflow: its base and how many of its pages are chosen. */
export function workflowCards(list: LineWorkflowList): WorkflowCard[] {
  return list.workflows.map((w) => {
    const chosen = w.roles.filter((r) => r.page).length;
    const lib = w.base?.libraryId ? w.base.libraryId.split('/').pop() : null;
    const pages = w.roles.length === 0 ? 'No pages to choose.' : chosen === w.roles.length ? `All ${w.roles.length} pages chosen.` : `${chosen} of ${w.roles.length} pages chosen.`;
    return { id: w.id, name: w.name, base: lib ? `Based on ${lib}` : 'Not based on a library workflow', pages, ok: !!lib && chosen === w.roles.length && w.roles.every((r) => r.pageOk) };
  });
}

/** A name for a new feature workflow based on `libName`, not taken yet: "ordersListDetail", then "ordersListDetail2". */
export function suggestName(list: LineWorkflowList, libName: string): string {
  const stem = `${list.feature.replace(/[^A-Za-z0-9]/g, '')}${upper(libName)}`.replace(/^[^A-Za-z]+/, '') || upper(libName);
  const taken = new Set(list.workflows.map((w) => w.name));
  if (!taken.has(stem)) return stem;
  let n = 2;
  while (taken.has(`${stem}${n}`)) n += 1;
  return `${stem}${n}`;
}
