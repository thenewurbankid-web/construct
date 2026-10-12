import assert from 'node:assert/strict';
import { fireEvent } from '@testing-library/react';
import { Avatar } from '../../library/components/Avatar';
import type { Ctx, Kit } from '../kit/harness';

const avatar = (c: Ctx) => c.screen.getByRole('img', { name: 'Ada Lovelace' });
const img = (c: Ctx) => c.container.querySelector('img') as HTMLImageElement;

export const kit: Kit = {
  name: 'Avatar',
  render: (props) => <Avatar name="Ada Lovelace" {...props} />,
  states: {
    default: { check: (c) => { assert.equal(avatar(c).textContent, 'AL'); assert.equal(img(c), null); } },
    image: { props: { src: '/ada.png' }, check: (c) => { assert.equal(img(c).getAttribute('src'), '/ada.png'); assert.equal(img(c).getAttribute('alt'), ''); } },
    fallback: { props: { src: '/missing.png' }, act: (c) => { fireEvent.error(img(c)); }, check: (c) => { assert.equal(img(c), null); assert.equal(avatar(c).textContent, 'AL'); assert.equal(avatar(c).getAttribute('data-status'), 'fallback'); } },
  },
  events: {
    loadStatus: { props: { src: '/ada.png' }, act: (c) => { fireEvent.load(img(c)); }, expect: (calls) => assert.deepEqual(calls[0], ['loaded']) },
  },
  keys: {},
};
