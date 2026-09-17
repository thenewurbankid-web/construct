import { getJson, postJson } from '@/lib/http';
import type { Settings } from '../types';

export const fetchSettings = () => getJson<Settings>('/api/settings');

export const saveSettings = (body: { projectDir: string; llmProvider: string }) =>
  postJson<Settings & { error?: string }>('/api/settings', body);
