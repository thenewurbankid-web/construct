import { postJson } from '@/lib/http';
import type { CommandResult, RefactorInput } from '../types';

// Real network effect (SERVICE-*) — a thin wrapper over ui/server's
// POST /api/refactor.
export const refactorCommand = (body: RefactorInput) => postJson<CommandResult>('/api/refactor', body);
