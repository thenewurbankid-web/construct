// Line Import v2 shapes that iv2-fit uses, mirrored from docs/line/import-v2/CONTRACT.md "Shapes". Branch iv2-map owns
// importV2/contract.mjs; these typedefs and checks move into it when the branches merge (same names, same fields).
//
//   RouteClosure   readRouteFamily's result (route.mjs)
//   LogicUnit      one unit of a logic map (only the fields fit reads)
//   FitProposal    fitLogic's result (fit.mjs): every unit in exactly one block, the rest listed with a sentence
//   FitStep        one plan step planFitSteps proposes (a line.import.* tool and its args)

/**
 * @typedef {object} RouteClosure
 * @property {string} appRoot   The app (absolute).
 * @property {{route: string, entry: string}[]} routes  The family's routes, each with its entry file (app-relative).
 * @property {string[]} files   Every app file the routes import, app-relative, sorted.
 * @property {string[]} external The boundaries the trace stopped at: excluded files, packages, unresolved imports.
 */

/**
 * @typedef {'branch'|'render-if'|'state'|'effect'|'derived'|'data'|'navigation'|'url-read'|'handler'|'toast'|'analytics'|'storage'|'io'|'export'} LogicUnitKind
 */

/**
 * @typedef {object} LogicUnit
 * @property {string} id            `file#fn:kind:n`, for display only.
 * @property {string} [fingerprint] Stable across moves (iv2-map); fit keys units by it when present, else by id.
 * @property {LogicUnitKind} kind
 * @property {string} file          App-relative.
 * @property {string} fn            The innermost named function, `<module>` at the top level, `on:<attr>` for an inline handler.
 * @property {number} line
 * @property {string} detail
 */

/** @typedef {'page'|'component'|'workflow'|'fixture'|'usecase'|'service'|'domain'} FitBlockKind */

/**
 * @typedef {object} FitBlock
 * @property {FitBlockKind} kind
 * @property {string} name
 * @property {string[]} units   Unit keys (fingerprint, else id).
 * @property {string[]} from    Where the code is now: `file#name` (a top-level declaration) or `file` (the whole file).
 * @property {string} sentence  Why these units make this block, in plain English.
 * @property {'feature'|'library'} [area] iv2-fit extension (reconcile with iv2-map): library when other routes use it.
 */

/**
 * @typedef {object} FitProposal
 * @property {string} feature
 * @property {FitBlock[]} blocks
 * @property {{unit: string, sentence: string}[]} unassigned
 */

/**
 * @typedef {object} FitStep
 * @property {string} id
 * @property {'line.import.extractService'|'line.import.extractDomain'|'line.import.extractUsecase'|'line.import.extractWorkflow'|'line.import.splitPage'} tool
 * @property {Record<string, unknown>} args  Always holds `folder`; paths inside args are folder-relative.
 * @property {string} sentence
 * @property {string[]} blocks  The proposal blocks (kind:name) this step lands.
 */

/** The block kinds a fit proposal may use, in fitting-rule order. */
export const FIT_BLOCK_KINDS = Object.freeze(['service', 'domain', 'usecase', 'workflow', 'component', 'page', 'fixture']);
/** The Line folder each block kind lands in. */
export const KIND_FOLDER = Object.freeze({ page: 'pages', component: 'components', workflow: 'workflows', fixture: 'fixtures', usecase: 'usecases', service: 'services', domain: 'domains' });

const fail = (where, what) => { throw new TypeError(`${where}: ${what}`); };
const str = (v, where) => (typeof v === 'string' && v.length > 0) || fail(where, 'must be a non-empty string');
const sentence = (v, where) => { str(v, where); if (!/[.?!]$/.test(v)) fail(where, 'must be a sentence'); };

/**
 * Throws unless c is a RouteClosure.
 * @param {any} c
 * @returns {asserts c is RouteClosure}
 */
export function assertRouteClosure(c) {
  str(c?.appRoot, 'closure.appRoot');
  if (!Array.isArray(c.routes) || !c.routes.length) fail('closure.routes', 'must list at least one route');
  c.routes.forEach((r, i) => { str(r?.route, `closure.routes[${i}].route`); str(r.entry, `closure.routes[${i}].entry`); });
  if (!Array.isArray(c.files) || !c.files.every((f) => typeof f === 'string' && f && !f.startsWith('/') && !f.startsWith('..'))) fail('closure.files', 'must be app-relative paths');
  if (!Array.isArray(c.external)) fail('closure.external', 'must be an array');
}

/**
 * Throws unless p is a FitProposal in which every unit key appears exactly once (in one block or as unassigned).
 * @param {any} p
 * @param {string[]} [unitKeys] When given, the proposal must account for exactly these units.
 * @returns {asserts p is FitProposal}
 */
export function assertFitProposal(p, unitKeys) {
  str(p?.feature, 'fit.feature');
  if (!Array.isArray(p.blocks) || !Array.isArray(p.unassigned)) fail('fit', 'blocks and unassigned must be arrays');
  const seen = new Map();
  const note = (k, where) => { if (seen.has(k)) fail(where, `unit ${k} is already in ${seen.get(k)}`); seen.set(k, where); };
  const names = new Set();
  p.blocks.forEach((b, i) => {
    const w = `fit.blocks[${i}]`;
    if (!FIT_BLOCK_KINDS.includes(b?.kind)) fail(`${w}.kind`, `must be one of ${FIT_BLOCK_KINDS.join(', ')}`);
    str(b.name, `${w}.name`);
    if (names.has(`${b.kind}:${b.name}`)) fail(`${w}.name`, 'must be unique per kind');
    names.add(`${b.kind}:${b.name}`);
    if (!Array.isArray(b.units) || !b.units.length) fail(`${w}.units`, 'a block holds at least one unit');
    b.units.forEach((u) => note(u, `${w} (${b.kind} ${b.name})`));
    if (!Array.isArray(b.from) || !b.from.length) fail(`${w}.from`, 'must say where the code is now');
    sentence(b.sentence, `${w}.sentence`);
    if (b.area !== undefined && !['feature', 'library'].includes(b.area)) fail(`${w}.area`, 'must be feature or library');
  });
  p.unassigned.forEach((u, i) => { str(u?.unit, `fit.unassigned[${i}].unit`); sentence(u.sentence, `fit.unassigned[${i}].sentence`); note(u.unit, `fit.unassigned[${i}]`); });
  if (unitKeys) {
    const missing = unitKeys.filter((k) => !seen.has(k));
    if (missing.length) fail('fit', `${missing.length} unit(s) are in no block and not listed as unassigned, such as ${missing[0]}`);
    if (seen.size !== new Set(unitKeys).size) fail('fit', 'lists units that are not in the map');
  }
}
