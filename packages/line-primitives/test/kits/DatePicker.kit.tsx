import assert from 'node:assert/strict';
import { waitFor } from '@testing-library/react';
import { DatePicker } from '../../library/components/DatePicker';
import type { Ctx, Kit } from '../kit/harness';

// Wednesday 14 October 2026: a fixed day, so the keyboard checks do not depend on today.
const DAY = new Date(2026, 9, 14);
const trigger = (c: Ctx) => c.screen.getByRole('button', { name: /Delivery date/, hidden: true });
const open = async (c: Ctx) => { await c.user.click(trigger(c)); await waitFor(() => assert.equal(document.activeElement?.getAttribute('aria-label'), 'Wednesday 14 October 2026')); };
const focusedDay = (_c: Ctx) => document.activeElement?.getAttribute('aria-label');
const press = (k: string, expected: string) => ({
  props: { defaultValue: DAY },
  act: async (c: Ctx) => { await open(c); await c.user.keyboard(k); },
  check: (c: Ctx) => waitFor(() => assert.equal(focusedDay(c), expected)),
});

export const kit: Kit = {
  name: 'DatePicker',
  render: (props) => <DatePicker label="Delivery date" {...props} />,
  states: {
    default: { check: (c) => assert.match(trigger(c).textContent ?? '', /Pick a date/) },
    value: { props: { defaultValue: DAY }, check: (c) => assert.match(trigger(c).textContent ?? '', /October 14(th)?, 2026/) },
    open: { props: { defaultValue: DAY, min: new Date(2026, 9, 10) }, act: open, check: (c) => {
      const grid = c.screen.getByRole('grid', { name: 'October 2026' });
      assert.ok(grid);
      assert.equal(c.screen.getByRole('button', { name: 'Wednesday 14 October 2026' }).closest('td')?.getAttribute('aria-selected'), 'true');
      assert.equal(c.screen.getByRole('button', { name: 'Friday 9 October 2026' }).getAttribute('aria-disabled'), 'true');
    } },
    disabled: { props: { disabled: true }, check: (c) => assert.equal((trigger(c) as HTMLButtonElement).disabled, true) },
    invalid: { props: { error: 'Choose a weekday.' }, check: (c) => { assert.equal(trigger(c).getAttribute('aria-invalid'), 'true'); assert.equal(c.screen.getByRole('alert').textContent, 'Choose a weekday.'); } },
    required: { props: { required: true }, check: (c) => assert.match(c.screen.getByText('(required)', { exact: false }).textContent ?? '', /\(required\)/) },
  },
  events: {
    change: { props: { defaultValue: DAY }, act: async (c) => { await open(c); await c.user.click(c.screen.getByRole('button', { name: 'Friday 16 October 2026' })); }, expect: (calls) => assert.equal((calls[0][0] as Date).getDate(), 16) },
    openChange: { act: (c) => c.user.click(trigger(c)), expect: (calls) => assert.deepEqual(calls[0], [true]) },
  },
  keys: {
    ArrowRight: press('{ArrowRight}', 'Thursday 15 October 2026'),
    ArrowLeft: press('{ArrowLeft}', 'Tuesday 13 October 2026'),
    ArrowDown: press('{ArrowDown}', 'Wednesday 21 October 2026'),
    ArrowUp: press('{ArrowUp}', 'Wednesday 7 October 2026'),
    PageDown: press('{PageDown}', 'Saturday 14 November 2026'),
    PageUp: press('{PageUp}', 'Monday 14 September 2026'),
    Home: press('{Home}', 'Monday 12 October 2026'),
    End: press('{End}', 'Sunday 18 October 2026'),
    Enter: { props: (spy) => ({ defaultValue: DAY, onValueChange: spy }), act: async (c) => { await open(c); await c.user.keyboard('{ArrowRight}'); await waitFor(() => assert.equal(focusedDay(c), 'Thursday 15 October 2026')); await c.user.keyboard('{Enter}'); }, check: (c) => { assert.equal((c.spy.mock.calls[0]?.arguments[0] as Date).getDate(), 15); assert.equal(c.screen.queryByRole('grid'), null); } },
    Escape: { props: { defaultValue: DAY }, act: async (c) => { await open(c); await c.user.keyboard('{Escape}'); }, check: (c) => assert.equal(c.screen.queryByRole('grid'), null) },
  },
};
