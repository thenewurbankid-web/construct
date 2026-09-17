import { postJson } from '@/lib/http';
import type { CommandResult, CreateInput, ImportInput, RefactorInput, ResearchInput } from '../types';

// Real network effects live here, not in the hook/page/component (SERVICE-*)
// — one thin wrapper per ui/server command endpoint (ui/server/src/index.mjs).
export const createCommand = (body: CreateInput) => postJson<CommandResult>('/api/create', body);
export const refactorCommand = (body: RefactorInput) => postJson<CommandResult>('/api/refactor', body);
export const researchCommand = (body: ResearchInput) => postJson<CommandResult>('/api/research', body);
export const importCommand = (body: ImportInput) => postJson<CommandResult>('/api/import', body);
