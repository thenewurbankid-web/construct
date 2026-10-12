import { lineHttp } from '@/lib/lineHttp';
import type { LineComponentsApi } from '../types';

/** The Components editor reads through the shared LINE_API mirror (GET /api/line/component); every change it makes is a
 * plan step added through the Plan panel (useLinePlan's addStep), never a direct write. */
export const lineComponentsApi: LineComponentsApi = { getComponent: (file) => lineHttp.getComponent(file) };
