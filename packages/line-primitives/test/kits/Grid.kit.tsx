import assert from 'node:assert/strict';
import { Grid } from '../../library/components/Grid';
import type { Kit } from '../kit/harness';

export const kit: Kit = {
  name: 'Grid',
  render: (props) => <Grid columns="4" as="ul" label="Products" {...props}><li>A</li><li>B</li></Grid>,
  states: {
    default: { check: (c) => { const list = c.screen.getByRole('list', { name: 'Products' }); assert.match(list.className, /md:grid-cols-4/); assert.equal(c.screen.getAllByRole('listitem').length, 2); } },
  },
  events: {},
  keys: {},
};
