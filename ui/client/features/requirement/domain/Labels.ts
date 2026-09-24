// Pure (DOMAIN-001): the words for the kinds the deterministic blocks return. Fixed tables; nothing is decided by a model.
import type { NounKind, PlacementKind, VerbKind } from './RequirementTypes.ts';

export const NOUN_LABEL: Record<NounKind, string> = { entity: 'Data', state: 'State', 'ui-part': 'Screen part', external: 'Outside service' };
export const VERB_LABEL: Record<VerbKind, string> = { read: 'Read', write: 'Write', interact: 'Interact', navigate: 'Navigate' };
export const PLACEMENT_LABEL: Record<PlacementKind, string> = { 'client-leaf': 'Client leaf', 'server-read': 'Server read', mutation: 'Mutation', presentational: 'Presentational' };
