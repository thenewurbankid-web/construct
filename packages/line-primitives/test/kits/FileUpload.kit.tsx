import assert from 'node:assert/strict';
import { fireEvent } from '@testing-library/react';
import { FileUpload } from '../../library/components/FileUpload';
import type { Ctx, Kit } from '../kit/harness';

const file = (name: string) => new File(['x'], name, { type: 'image/png' });
const input = (c: Ctx) => c.container.querySelector('input[type="file"]') as HTMLInputElement;
const trigger = (c: Ctx) => c.screen.getByRole('button', { name: 'Upload receipt' });
const dropzone = (c: Ctx) => c.container.querySelector('[data-part="dropzone"]') as HTMLElement;
const clicksOnInput = (c: Ctx) => { const seen: number[] = []; input(c).addEventListener('click', (e) => { e.preventDefault(); seen.push(1); }); return seen; };

export const kit: Kit = {
  name: 'FileUpload',
  render: (props) => <FileUpload label="Upload receipt" accept="image/*" {...props} />,
  states: {
    default: { check: (c) => { assert.ok(trigger(c)); assert.equal(c.screen.queryByRole('list'), null); } },
    value: { act: (c) => c.user.upload(input(c), file('receipt.png')), check: (c) => assert.ok(c.screen.getByRole('button', { name: 'Remove receipt.png' })) },
    dragOver: { act: (c) => { fireEvent.dragOver(dropzone(c)); }, check: (c) => assert.equal(dropzone(c).hasAttribute('data-drag-over'), true) },
    disabled: { props: { disabled: true }, check: (c) => { assert.equal((trigger(c) as HTMLButtonElement).disabled, true); assert.equal(input(c).disabled, true); } },
    invalid: { props: { error: 'Files must be under 5 MB.' }, check: (c) => { assert.equal(input(c).getAttribute('aria-invalid'), 'true'); assert.equal(c.screen.getByRole('alert').textContent, 'Files must be under 5 MB.'); } },
    multiple: { props: { multiple: true }, act: (c) => c.user.upload(input(c), [file('a.png'), file('b.png')]), check: (c) => assert.equal(c.screen.getAllByRole('listitem').length, 2) },
  },
  events: {
    filesChange: { act: (c) => c.user.upload(input(c), file('a.png')), expect: (calls) => assert.equal((calls[0][0] as File[])[0].name, 'a.png') },
    remove: { act: async (c) => { await c.user.upload(input(c), file('a.png')); await c.user.click(c.screen.getByRole('button', { name: 'Remove a.png' })); }, expect: (calls) => assert.equal((calls[0][0] as File).name, 'a.png') },
  },
  keys: {
    Enter: { act: async (c) => { const seen = clicksOnInput(c); trigger(c).focus(); await c.user.keyboard('{Enter}'); assert.equal(seen.length, 1); }, check: (c) => assert.equal(document.activeElement, trigger(c)) },
    Space: { act: async (c) => { const seen = clicksOnInput(c); trigger(c).focus(); await c.user.keyboard(' '); assert.equal(seen.length, 1); }, check: (c) => assert.equal(document.activeElement, trigger(c)) },
  },
};
