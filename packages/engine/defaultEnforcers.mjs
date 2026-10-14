// The canonical enforcer list `construct validate` runs -- pulled out of
// packages/core/cli.mjs (which still imports this, unchanged behavior) so
// packages/engine/pipeline.mjs can validate a buffered transaction against
// exactly the same enforcers `construct validate` uses, without a circular
// import between cli.mjs and the engine.
import { validateArchitecture } from '@line/construct-core/architecture-enforcer';
import { validateSeparationOfConcerns } from '@line/construct-core/soc-enforcer';
import { validateReadability } from '@line/construct-core/readability-enforcer';
import { checkPublicApiDrift } from '@line/construct-core/api-composer';
import { validateLocalRules } from '@line/construct-core/local-rules';
import { validateBooleanNames } from './lsp/booleanNames.mjs';

export const DEFAULT_ENFORCERS = [
  { name: 'architecture', validate: validateArchitecture },
  { name: 'separation-of-concerns', validate: validateSeparationOfConcerns },
  { name: 'readability', validate: validateReadability },
  { name: 'public-api-drift', validate: checkPublicApiDrift },
  // #553 -- project-local rules from architecture.yml's `localRules:` list; a no-op enforcer
  // (empty violations) for every project that doesn't declare any.
  { name: 'local-rules', validate: validateLocalRules },
  // NAME-002: boolean functions named is/has/can/should/does, read through the TypeScript language service.
  { name: 'boolean-names', validate: validateBooleanNames },
];
