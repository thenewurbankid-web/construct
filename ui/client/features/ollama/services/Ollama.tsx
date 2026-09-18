import { getJson } from '@/lib/http';
import type { OllamaStatus, OllamaModel } from '../types';

export const fetchOllamaStatus = () => getJson<OllamaStatus>('/api/ollama/status');

export const fetchOllamaModels = () => getJson<{ models: OllamaModel[] } | { ok: false; error: string }>('/api/ollama/models');
