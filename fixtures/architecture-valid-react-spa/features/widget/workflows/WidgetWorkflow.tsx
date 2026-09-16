import { setup } from 'xstate';
import { fetchWidget } from '../services/WidgetService';

export const WidgetWorkflow = setup({}).createMachine({
  id: 'widget',
  initial: 'idle',
  states: { idle: {} },
});

export { fetchWidget };
