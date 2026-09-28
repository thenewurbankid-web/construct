// #545 -- the per-rule catalog: one Rule (packages/core/rules/types.mjs's contract) per file in
// this directory, migrated rule by rule out of architecture-enforcer.mjs's detectLayerViolations
// and soc-enforcer.mjs/readability-enforcer.mjs's hard-coded branches. Add a new file + its
// fixtures/<RULE-ID>/{violates,passes} pair, then list it in `RULES` below -- nothing else in
// the catalog needs to change for one more rule to exist in it.
import { rule as ROUTE_001 } from './route-001.mjs';
import { rule as ROUTE_002 } from './route-002.mjs';
import { rule as SERVICE_002 } from './service-002.mjs';
import { rule as WORKFLOW_001 } from './workflow-001.mjs';

/** @type {import('./types.mjs').Rule[]} */
export const RULES = [ROUTE_001, ROUTE_002, SERVICE_002, WORKFLOW_001];

/** @param {string} id @returns {import('./types.mjs').Rule | undefined} */
export function findRule(id) {
  return RULES.find((r) => r.id === id);
}

// #545's own scope survey: every rule id named in the ticket's buffer/project split, confirmed
// against what its current detector (architecture-enforcer.mjs/soc-enforcer.mjs/
// readability-enforcer.mjs) actually reads, independent of whether it has been migrated into
// `RULES` above yet. A rule is 'project' the moment its detection needs more than one file's own
// {source, layer, config} -- another file's contents, the whole-project import graph, or a
// cross-file duplicate/uniqueness check.
//
//   - buffer: PAGE-001/002/003/004/005/006/008/009, COMPONENT-001/002/003/005/006, ROUTE-001/002,
//     CONTROLLER-001/003, DOMAIN-001/002, PURE-001, EXPR-001..006, HOOK-001/002/003,
//     WORKFLOW-001/002/003/004, SERVICE-001/002/003, STATE-001, ROUTE-003 -- each reads only its
//     own source text (parsed to an AST) plus, where noted, the normalized config for an
//     opt-in flag or a numeric budget override. Confirms every buffer candidate the ticket
//     lists, plus several more (#589/#597's SERVICE-001/PAGE-001/COMPONENT-001/PURE-001,
//     #578/#581/#594/#667/#668/#669's flag-gated rules) added to detectLayerViolations after the
//     ticket's list was written.
//   - project: IMPORT-001 (resolves a relative import against the filesystem), SOC-001 (the
//     whole layer graph plus every other file's classification), DRY-001, SLICE-001/002/004,
//     MODULE-001, READ-* (cross-file duplicate/public-API/module-boundary checks), CLIENT-001
//     and TYPE-001 (whole-project static analysis / tsc). Confirms every project candidate the
//     ticket lists.
export const CONFIRMED_BUFFER_RULE_IDS = Object.freeze([
  'PAGE-001', 'PAGE-002', 'PAGE-003', 'PAGE-004', 'PAGE-005', 'PAGE-006', 'PAGE-008', 'PAGE-009',
  'COMPONENT-001', 'COMPONENT-002', 'COMPONENT-003', 'COMPONENT-005', 'COMPONENT-006',
  'ROUTE-001', 'ROUTE-002', 'ROUTE-003',
  'CONTROLLER-001', 'CONTROLLER-003',
  'DOMAIN-001', 'DOMAIN-002', 'PURE-001',
  'EXPR-001', 'EXPR-002', 'EXPR-003', 'EXPR-004', 'EXPR-005', 'EXPR-006',
  'HOOK-001', 'HOOK-002', 'HOOK-003',
  'WORKFLOW-001', 'WORKFLOW-002', 'WORKFLOW-003', 'WORKFLOW-004',
  'SERVICE-001', 'SERVICE-002', 'SERVICE-003',
  'STATE-001',
]);

export const CONFIRMED_PROJECT_RULE_IDS = Object.freeze([
  'IMPORT-001', 'SOC-001', 'DRY-001',
  'SLICE-001', 'SLICE-002', 'SLICE-004',
  'MODULE-001',
  'READ-001', 'READ-002', 'READ-003', 'READ-004',
  'CLIENT-001', 'TYPE-001',
]);
