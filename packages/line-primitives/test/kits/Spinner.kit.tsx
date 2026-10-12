import assert from 'node:assert/strict';
import { Spinner } from '../../library/components/Spinner';
import type { Kit } from '../kit/harness';

export const kit: Kit = {
  name: 'Spinner',
  render: (props) => <Spinner label="Loading orders" {...props} />,
  states: {
    default: { check: (c) => assert.equal(c.screen.getByRole('status').textContent, 'Loading orders') },
  },
  events: {},
  keys: {},
};
