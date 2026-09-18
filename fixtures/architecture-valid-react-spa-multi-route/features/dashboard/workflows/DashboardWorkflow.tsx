import { setup } from 'xstate';
import { fetchDashboard } from '../services/DashboardService';

export const DashboardWorkflow = setup({}).createMachine({
  id: 'dashboard',
  initial: 'idle',
  states: { idle: {} },
});

export { fetchDashboard };
