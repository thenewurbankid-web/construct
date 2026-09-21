import { getJson } from '@/lib/http';
import type { FeatureIndexResponse, FeatureSummaryResponse } from '../types';

// The two read-only endpoints over the core unit summaries (the same JSON as `construct summarize`).
export const getFeatureIndex = () => getJson<FeatureIndexResponse>('/api/features');

/** `name` is always a name from the index the server just gave (the server resolves it as a feature reference, never a path). */
export const getFeatureSummary = (name: string) => getJson<FeatureSummaryResponse>(`/api/features/${encodeURIComponent(name)}/summary?detail=standard`);
