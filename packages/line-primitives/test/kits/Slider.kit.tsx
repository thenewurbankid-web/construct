import assert from 'node:assert/strict';
import { Slider } from '../../library/components/Slider';
import type { Ctx, Kit } from '../kit/harness';

const thumb = (c: Ctx) => c.screen.getByRole('slider', { name: 'Volume' });
const now = (c: Ctx) => thumb(c).getAttribute('aria-valuenow');
const press = (k: string, start = 50) => ({
  props: { defaultValue: start },
  act: async (c: Ctx) => { thumb(c).focus(); await c.user.keyboard(k); },
});

export const kit: Kit = {
  name: 'Slider',
  render: (props) => <Slider label="Volume" {...props} />,
  states: {
    default: { props: { defaultValue: 30 }, check: (c) => { assert.equal(now(c), '30'); assert.equal(thumb(c).getAttribute('aria-valuemin'), '0'); assert.equal(thumb(c).getAttribute('aria-valuemax'), '100'); } },
    disabled: { props: { disabled: true }, check: (c) => assert.ok(thumb(c).hasAttribute('data-disabled')) },
    orientation: { props: { orientation: 'vertical' }, check: (c) => assert.equal(thumb(c).getAttribute('aria-orientation'), 'vertical') },
  },
  events: {
    change: { props: { defaultValue: 10 }, act: async (c) => { thumb(c).focus(); await c.user.keyboard('{ArrowRight}'); }, expect: (calls) => assert.deepEqual(calls[0], [11]) },
    commit: { props: { defaultValue: 10 }, act: async (c) => { thumb(c).focus(); await c.user.keyboard('{ArrowRight}'); }, expect: (calls) => assert.deepEqual(calls[0], [11]) },
  },
  keys: {
    ArrowRight: { ...press('{ArrowRight}'), check: (c) => assert.equal(now(c), '51') },
    ArrowLeft: { ...press('{ArrowLeft}'), check: (c) => assert.equal(now(c), '49') },
    ArrowUp: { ...press('{ArrowUp}'), check: (c) => assert.equal(now(c), '51') },
    ArrowDown: { ...press('{ArrowDown}'), check: (c) => assert.equal(now(c), '49') },
    Home: { ...press('{Home}'), check: (c) => assert.equal(now(c), '0') },
    End: { ...press('{End}'), check: (c) => assert.equal(now(c), '100') },
    PageUp: { ...press('{PageUp}'), check: (c) => assert.equal(now(c), '60') },
    PageDown: { ...press('{PageDown}'), check: (c) => assert.equal(now(c), '40') },
  },
};
