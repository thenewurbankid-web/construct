import assert from 'node:assert/strict';
import { Progress } from '../../library/components/Progress';
import type { Ctx, Kit } from '../kit/harness';

const bar = (c: Ctx) => c.screen.getByRole('progressbar', { name: 'Uploading' });

export const kit: Kit = {
  name: 'Progress',
  render: (props) => <Progress label="Uploading" showValue {...props} />,
  states: {
    default: { props: { value: 40 }, check: (c) => { assert.equal(bar(c).getAttribute('aria-valuenow'), '40'); assert.equal(bar(c).getAttribute('aria-valuemax'), '100'); assert.match(c.container.textContent ?? '', /40%/); } },
    loading: { check: (c) => { assert.equal(bar(c).hasAttribute('aria-valuenow'), false); assert.equal(bar(c).getAttribute('data-state'), 'indeterminate'); } },
    complete: { props: { value: 100 }, check: (c) => assert.equal(bar(c).getAttribute('data-state'), 'complete') },
  },
  events: {},
  keys: {},
};
