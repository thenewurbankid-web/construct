import assert from 'node:assert/strict';
import { Text } from '../../library/components/Text';
import type { Kit } from '../kit/harness';

export const kit: Kit = {
  name: 'Text',
  render: (props) => (
    <div>
      <Text as="h2" {...props}>Delivery</Text>
      <Text tone="muted">Press <Text as="kbd">Enter</Text> to save, or run <Text as="code">npm test</Text>.</Text>
    </div>
  ),
  states: {
    default: { check: (c) => {
      assert.ok(c.screen.getByRole('heading', { level: 2, name: 'Delivery' }));
      assert.equal(c.container.querySelector('kbd')?.textContent, 'Enter');
      assert.equal(c.container.querySelector('code')?.textContent, 'npm test');
      assert.equal(c.container.querySelector('p')?.getAttribute('data-tone'), 'muted');
    } },
  },
  events: {},
  keys: {},
};
