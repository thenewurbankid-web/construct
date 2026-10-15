import { lineHttp } from '@/lib/lineHttp';
import type { LineEnglishApi } from '../types';

/** The English panel reads through the shared LINE_API mirror (GET /api/line/english); it never writes. */
export const lineEnglishApi: LineEnglishApi = { getEnglish: (file) => lineHttp.getEnglish(file) };
