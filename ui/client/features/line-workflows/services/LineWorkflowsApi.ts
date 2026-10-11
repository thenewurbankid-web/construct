import { lineHttp } from '@/lib/lineHttp';
import type { LineWorkflowsApi } from '../types';

/** The Workflows tab reads through the shared LINE_API mirror (GET /api/line/workflows); every change it makes is a
 * plan step added through the Plan panel (useLinePlan's addStep), never a direct write. */
export const lineWorkflowsApi: LineWorkflowsApi = { getWorkflows: (feature) => lineHttp.getWorkflows(feature) };
