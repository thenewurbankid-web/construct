// Line Import v2: which file each line.import.extract* tool writes (the pure part of importV2/extract.mjs). Pure (no Node
// imports), so the plan conditions (conditions.mjs) and the import loop read it in Cockpit's mock mode too.

/** The extract tools and the Line kind folder each writes into. */
export const EXTRACT_KIND = Object.freeze({
  'line.import.extractService': 'services',
  'line.import.extractDomain': 'domains',
  'line.import.extractUsecase': 'usecases',
  'line.import.splitPage': 'usecases',
  'line.import.extractWorkflow': 'workflows',
});
/** Every extract tool's name. */
export const EXTRACT_TOOLS = Object.freeze(Object.keys(EXTRACT_KIND));

/** The extension of a path (`.tsx`), or '' when it has none. */
const extOf = (rel) => { const base = String(rel).split('/').pop() ?? ''; const i = base.lastIndexOf('.'); return i > 0 ? base.slice(i) : ''; };

/**
 * The folder-relative file a tool writes for a request (the library when no feature is named).
 * @param {{features?: string, library?: string} | undefined} layout The folder's layout (defaults: features, library).
 * @param {string} tool
 * @param {Record<string, any>} args
 * @returns {string}
 */
export function extractTarget(layout, tool, args) {
  const kind = EXTRACT_KIND[/** @type {keyof typeof EXTRACT_KIND} */ (tool)];
  const area = args?.feature ? `${(layout?.features ?? 'features').replace(/\/+$/, '')}/${args.feature}` : (layout?.library ?? 'library').replace(/\/+$/, '');
  const ext = tool === 'line.import.extractWorkflow' ? '.ts' : extOf(String(args?.from ?? '.ts')) || '.ts';
  return `${area}/${kind}/${args?.name}${ext}`;
}
