import assert from 'node:assert/strict';
import { Divider } from '../../library/components/Divider';
import type { Kit } from '../kit/harness';

export const kit: Kit = {
  name: 'Divider',
  render: (props) => <Divider {...props} />,
  states: {
    default: { check: (c) => { const el = c.container.firstElementChild; assert.equal(el?.getAttribute('role'), 'none'); assert.equal(el?.getAttribute('data-orientation'), 'horizontal'); } },
    orientation: { props: { orientation: 'vertical', decorative: false }, check: (c) => { const sep = c.screen.getByRole('separator'); assert.equal(sep.getAttribute('aria-orientation'), 'vertical'); } },
  },
  events: {},
  keys: {},
};
