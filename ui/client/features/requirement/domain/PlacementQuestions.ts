// Pure (DOMAIN-001): the three placement questions, in the order they are asked (docs/PLACEMENT.md).
import type { PlacementBlock } from './RequirementTypes.ts';

export const QUESTIONS: { key: keyof PlacementBlock['answers']; text: string }[] = [
  { key: 'browserApi', text: 'Does it need the browser?' },
  { key: 'touchesSecretOrDb', text: 'Does it touch a secret or a database?' },
  { key: 'changesBackend', text: 'Does it change data on the backend?' },
];
