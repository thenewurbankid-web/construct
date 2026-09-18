// The canonical enforcer list `construct validate` runs -- pulled out of
// src/cli.mjs (which still imports this, unchanged behavior) so
// src/engine/pipeline.mjs can validate a buffered transaction against
// exactly the same enforcers `construct validate` uses, without a circular
// import between cli.mjs and the engine.
import { validateArchitecture } from '../architecture-enforcer.mjs';
import { validateSeparationOfConcerns } from '../soc-enforcer.mjs';
import { validateReadability } from '../readability-enforcer.mjs';
import { checkPublicApiDrift } from '../api-composer.mjs';

export const DEFAULT_ENFORCERS = [
  { name: 'architecture', validate: validateArchitecture },
  { name: 'separation-of-concerns', validate: validateSeparationOfConcerns },
  { name: 'readability', validate: validateReadability },
  { name: 'public-api-drift', validate: checkPublicApiDrift },
];
