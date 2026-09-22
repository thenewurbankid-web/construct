// The canonical enforcer list `construct validate` runs -- pulled out of
// packages/core/cli.mjs (which still imports this, unchanged behavior) so
// packages/engine/pipeline.mjs can validate a buffered transaction against
// exactly the same enforcers `construct validate` uses, without a circular
// import between cli.mjs and the engine.
import { validateArchitecture } from '../core/architecture-enforcer.mjs';
import { validateSeparationOfConcerns } from '../core/soc-enforcer.mjs';
import { validateReadability } from '../core/readability-enforcer.mjs';
import { checkPublicApiDrift } from '../core/api-composer.mjs';

export const DEFAULT_ENFORCERS = [
  { name: 'architecture', validate: validateArchitecture },
  { name: 'separation-of-concerns', validate: validateSeparationOfConcerns },
  { name: 'readability', validate: validateReadability },
  { name: 'public-api-drift', validate: checkPublicApiDrift },
];
