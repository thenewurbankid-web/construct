import { postJson } from '@/lib/http';
import type { CommandResult, ImportInput } from '../types';

// Real network effect (SERVICE-*) — a thin wrapper over ui/server's
// POST /api/import.
export const importCommand = (body: ImportInput) => postJson<CommandResult>('/api/import', body);
