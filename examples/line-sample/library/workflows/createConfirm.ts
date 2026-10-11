// Create then confirm: a form page; Submit saves it (a service call), then a confirmation page shows the result.
import { setup } from 'xstate';

/** The pages this workflow needs: a feature fills each role with one of its own pages. */
export const roles = {
  form: 'The page with the form to fill in',
  confirm: 'The page that confirms what was created',
};

export const createConfirm = setup({
  actions: {
    callService: (_: unknown, _params: { service: string }) => {},
    setPartState: (_: unknown, _params: { part: string; state: string }) => {},
  },
}).createMachine({
  id: 'createConfirm',
  initial: 'form',
  states: {
    form: { on: { SUBMIT: { target: 'saving', actions: [{ type: 'callService', params: { service: 'save' } }] } } },
    saving: { on: { SAVED: 'confirm', FAILED: 'form' } },
    confirm: { on: { ANOTHER: 'form' } },
  },
});
