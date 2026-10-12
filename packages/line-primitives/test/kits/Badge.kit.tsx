import assert from 'node:assert/strict';
import { Badge } from '../../library/components/Badge';
import type { Kit } from '../kit/harness';

export const kit: Kit = {
  name: 'Badge',
  render: (props) => <Badge variant="success" dot {...props}>Paid</Badge>,
  states: {
    default: { check: (c) => { const b = c.container.querySelector('[data-variant]'); assert.equal(b?.textContent, 'Paid'); assert.equal(b?.getAttribute('data-variant'), 'success'); } },
  },
  events: {},
  keys: {},
};
