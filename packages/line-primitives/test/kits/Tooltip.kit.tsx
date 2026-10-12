import assert from 'node:assert/strict';
import { Button } from '../../library/components/Button';
import { Tooltip } from '../../library/components/Tooltip';
import type { Ctx, Kit } from '../kit/harness';

const trigger = (c: Ctx) => c.screen.getByRole('button', { name: 'Archive' });

export const kit: Kit = {
  name: 'Tooltip',
  render: (props) => <Tooltip content="Moves it out of your inbox" delayDuration={0} {...props}><Button label="Archive" /></Tooltip>,
  states: {
    default: { check: (c) => assert.equal(c.screen.queryByRole('tooltip'), null) },
    open: { props: { defaultOpen: true }, check: (c) => { const tip = c.screen.getByRole('tooltip'); assert.match(tip.textContent ?? '', /Moves it out of your inbox/); assert.ok(trigger(c).getAttribute('aria-describedby')); } },
  },
  events: {
    openChange: { act: (c) => c.user.tab(), expect: (calls) => assert.deepEqual(calls[0], [true]) },
  },
  keys: {
    Tab: { act: (c) => c.user.tab(), check: (c) => assert.ok(c.screen.getByRole('tooltip')) },
    Escape: { act: async (c) => { await c.user.tab(); await c.user.keyboard('{Escape}'); }, check: (c) => assert.equal(c.screen.queryByRole('tooltip'), null) },
  },
};
