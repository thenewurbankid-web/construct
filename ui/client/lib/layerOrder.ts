// Pure (DOMAIN-001). The client mirror of packages/core/generators.mjs's `LAYER_ORDER`: the server module is
// never imported into the browser bundle (no ui/client file imports packages/core), so this one-liner is kept
// in sync by layerOrder.spec.mjs, which compares it against the core export directly. LIN-150: this is the one
// client-side copy of the layer order -- feature-catalog's Tree view and the review feature's violation
// grouping both import it instead of each hand-maintaining their own (divergent) list.
export const LAYER_ORDER = ['domain', 'service', 'workflow', 'hook', 'component', 'expression', 'adapter', 'page', 'controller', 'viewmodel'];
