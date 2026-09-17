import { postJson } from '@/lib/http';
import type { CommandResult, ResearchInput } from '../types';

// Real network effect (SERVICE-*) — a thin wrapper over ui/server's
// POST /api/research.
export const researchCommand = (body: ResearchInput) => postJson<CommandResult>('/api/research', body);
