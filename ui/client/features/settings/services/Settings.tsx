import { getJson, postJson } from '@/lib/http';
import type { LlmProviders, Settings } from '../types';

export const fetchSettings = () => getJson<Settings>('/api/settings');

export const saveSettings = (body: { projectDir: string; llmProviders: LlmProviders }) =>
  postJson<Settings & { error?: string }>('/api/settings', body);
