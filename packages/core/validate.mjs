// Public entry point for the "validate" capability (`@line/construct-core/validate`).
// A thin barrel: the enforcer registry and formatting live in this package
// (registry.mjs, diagnostics.mjs); the default enforcer set is assembled in
// packages/engine/defaultEnforcers.mjs (it composes this package's own
// architecture/soc/readability/api-composer enforcers). See `construct validate`
// (packages/cli/construct.mjs -> packages/core/cli.mjs) for the CLI wrapper this mirrors.
export { aggregateValidation } from './registry.mjs';
export { formatReport, exitCodeForViolations, ConstructError, EXIT_CODES } from './diagnostics.mjs';
export { validateArchitecture } from './architecture-enforcer.mjs';
export { DEFAULT_ENFORCERS } from '../engine/defaultEnforcers.mjs';
