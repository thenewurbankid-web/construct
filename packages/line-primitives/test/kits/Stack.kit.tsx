import assert from 'node:assert/strict';
import { Stack } from '../../library/components/Stack';
import type { Kit } from '../kit/harness';

export const kit: Kit = {
  name: 'Stack',
  render: (props) => <Stack {...props}><span>One</span><span>Two</span></Stack>,
  states: {
    default: { check: (c) => { const el = c.container.firstElementChild; assert.match(el?.className ?? '', /flex-col/); assert.match(el?.className ?? '', /gap-4/); } },
    orientation: { props: { direction: 'row', gap: '2', as: 'nav', label: 'Sections' }, check: (c) => { const nav = c.screen.getByRole('navigation', { name: 'Sections' }); assert.match(nav.className, /flex-row/); assert.equal(nav.getAttribute('data-direction'), 'row'); } },
  },
  events: {},
  keys: {},
};
