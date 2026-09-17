import { postJson } from '@/lib/http';
import type { CommandResult, CreateInput } from '../types';

// Real network effect (SERVICE-*) — a thin wrapper over ui/server's
// POST /api/create (see ui/server/src/index.mjs).
export const createCommand = (body: CreateInput) => postJson<CommandResult>('/api/create', body);
