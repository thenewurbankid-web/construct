// List then detail: a page lists items; opening one shows it on a detail page; Back returns to the list.
import { setup } from 'xstate';

/** The pages this workflow needs: a feature fills each role with one of its own pages. */
export const roles = {
  list: 'The page that lists the items',
  detail: 'The page that shows one item',
};

export const listDetail = setup({
  actions: {
    callService: (_: unknown, _params: { service: string }) => {},
    setPartState: (_: unknown, _params: { part: string; state: string }) => {},
  },
}).createMachine({
  id: 'listDetail',
  initial: 'list',
  states: {
    list: { on: { OPEN: 'detail' } },
    detail: { on: { BACK: 'list' } },
  },
});
