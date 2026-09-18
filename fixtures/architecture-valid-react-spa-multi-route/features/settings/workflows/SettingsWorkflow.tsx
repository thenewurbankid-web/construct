import { setup } from 'xstate';
import { fetchSettings } from '../services/SettingsService';

export const SettingsWorkflow = setup({}).createMachine({
  id: 'settings',
  initial: 'idle',
  states: { idle: {} },
});

export { fetchSettings };
