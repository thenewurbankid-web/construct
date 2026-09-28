// #545 -- the uniform rule contract every packages/core/rules/*.mjs file exports one of.
//
// Each rule owns its own file plus a violates/passes fixture pair (packages/core/rules/
// fixtures/<RULE-ID>/{violates,passes}.*) instead of being one more hard-coded branch inside
// detectLayerViolations/soc-enforcer.mjs/readability-enforcer.mjs. Migrating a rule here is
// additive: the old branch stays exactly as-is (do not delete or change it) until the golden
// characterization snapshot (#544, test/validate.characterization.golden.json) proves the two
// are byte-for-byte identical across every fixture/example project, at which point a later,
// separate ticket retires the old branch.
//
// `scope: 'buffer'` rules only ever need one file's own source/layer/config (the exact set a
// live editor buffer has, before it is even saved) -- LSP-shaped from day one. `scope: 'project'`
// rules additionally need the whole-project import graph (IMPORT-001, SOC-001, DRY-001,
// SLICE-*, MODULE-001, READ-*) and can only run over a real `construct validate`.

/**
 * @typedef {{source: string, layer: string, config: object}} BufferRuleContext
 *   The context a `scope: 'buffer'` rule's `detect` receives: one file's own source text, the
 *   layer it was classified as, and the project's normalized architecture.yml config (severities,
 *   overrides, exceptions) -- never another file's contents.
 *
 * @typedef {BufferRuleContext & {graph: object}} ProjectRuleContext
 *   What a `scope: 'project'` rule's `detect` additionally receives: the loaded layer graph
 *   (packages/core/architecture-graph.mjs's loadLayerGraph), so it can resolve/inspect other
 *   files' layers.
 *
 * @typedef {{line: number, message: string, suggestedFix?: string}} RuleHit
 *   One firing of a rule at a specific location. `why`/`expected` are NOT repeated per hit --
 *   they live once on the Rule itself, since every hit of a given rule explains itself the same
 *   way (only `message`, the concrete "what", varies per hit).
 *
 * @typedef {{
 *   id: string,
 *   module: 'architecture'|'separation-of-concerns'|'readability',
 *   layers: string[],
 *   scope: 'buffer'|'project',
 *   defaultSeverity: 'error'|'warning'|'info',
 *   why: string,
 *   expected: string[],
 *   detect: (ctx: BufferRuleContext|ProjectRuleContext) => RuleHit[],
 *   fix?: string,
 * }} Rule
 *   The uniform per-rule contract. `fix`, when present, names a Line block id that can resolve
 *   the violation (e.g. a refactor block) -- optional, since not every rule has one yet.
 */

export {};
