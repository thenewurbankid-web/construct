import assert from 'node:assert/strict';
import { Skeleton } from '../../library/components/Skeleton';
import type { Kit } from '../kit/harness';

export const kit: Kit = {
  name: 'Skeleton',
  render: (props) => <Skeleton {...props}><p>Loaded text</p></Skeleton>,
  states: {
    default: { check: (c) => { assert.equal(c.container.querySelectorAll('[data-part="line"]').length, 3); assert.equal(c.container.querySelector('[aria-busy="true"]') !== null, true); assert.equal(c.screen.queryByText('Loaded text'), null); } },
    loading: { props: { loading: false }, check: (c) => { assert.ok(c.screen.getByText('Loaded text')); assert.equal(c.container.querySelector('[aria-busy]'), null); } },
  },
  events: {},
  keys: {},
};
