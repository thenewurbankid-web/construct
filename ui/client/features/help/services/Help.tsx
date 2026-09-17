import { getJson } from '@/lib/http';
import type { HelpData } from '../types';

export const fetchHelp = () => getJson<HelpData>('/api/help');
