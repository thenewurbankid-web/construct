// The primitives' test-kit harness. A kit (test/kits/<Name>.kit.tsx) is data: how to render the primitive, and for
// every state, event and key of its contract (contract.mjs) the props, the action and the check. runKit turns a kit
// into node:test tests and first checks the kit against the contract, so a state, an event or a key the contract
// lists cannot go untested. Every state is also checked with axe (WCAG 2.0/2.1 A and AA rules).
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { ReactElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';

export type Spy = ReturnType<typeof mock.fn>;
export type Ctx = {
  user: ReturnType<typeof userEvent.setup>;
  screen: typeof screen;
  container: HTMLElement;
  /** A spy every kit entry can wire into its props (props may be a function of it). */
  spy: Spy;
  /** Re-render with other props (merged over the entry's). */
  rerender: (props: Record<string, unknown>) => void;
};
type Props = Record<string, unknown> | ((spy: Spy) => Record<string, unknown>);
export type KitEntry = { props?: Props; act?: (ctx: Ctx) => Promise<void> | void; check: (ctx: Ctx) => Promise<void> | void };
export type EventEntry = { props?: Props; act: (ctx: Ctx) => Promise<void> | void; expect?: (calls: unknown[][]) => void };
export type Kit = {
  name: string;
  render: (props: Record<string, unknown>) => ReactElement;
  /** One entry per contract state id. */
  states: Record<string, KitEntry>;
  /** One entry per contract event id: the spy goes on the event's prop and must be called. */
  events: Record<string, EventEntry>;
  /** One entry per contract keyboard key. */
  keys: Record<string, KitEntry>;
};
type Contract = { name: string; states: { id: string }[]; events: { id: string; prop: string }[]; keyboard: { key: string }[] };

/** Run axe on the whole document (portals render outside the container) and fail on any violation. */
export async function expectAxeClean(): Promise<void> {
  const result = await axe.run(document.body, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, rules: { 'color-contrast': { enabled: false } } });
  const found = result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join('; ')})`);
  assert.deepEqual(found, [], `axe found violations:\n${found.join('\n')}`);
}

function mount(kit: Kit, props: Props | undefined, extra: Record<string, unknown> = {}): Ctx {
  const spy = mock.fn();
  const base = typeof props === 'function' ? props(spy) : props ?? {};
  const merged = { ...base, ...extra };
  const view = render(kit.render(merged));
  const user = userEvent.setup({ pointerEventsCheck: 0, delay: null });
  return { user, screen, container: view.container, spy, rerender: (next) => view.rerender(kit.render({ ...merged, ...next })) };
}

const same = (a: string[], b: string[]) => [...new Set(a)].sort().join(',') === [...new Set(b)].sort().join(',');

/**
 * Turn a kit into tests: kit/contract agreement, then every state (with axe), every event and every key.
 * @param kit The primitive's kit.
 * @param contract The primitive's contract entry.
 */
export function runKit(kit: Kit, contract: Contract): void {
  describe(`${kit.name} primitive`, () => {
    it('its kit covers every state, event and key of its contract', () => {
      assert.ok(same(Object.keys(kit.states), contract.states.map((s) => s.id)), `${kit.name}: kit states ${Object.keys(kit.states)} vs contract ${contract.states.map((s) => s.id)}`);
      assert.ok(same(Object.keys(kit.events), contract.events.map((e) => e.id)), `${kit.name}: kit events ${Object.keys(kit.events)} vs contract ${contract.events.map((e) => e.id)}`);
      assert.ok(same(Object.keys(kit.keys), contract.keyboard.map((k) => k.key)), `${kit.name}: kit keys ${Object.keys(kit.keys)} vs contract ${contract.keyboard.map((k) => k.key)}`);
    });
    for (const [id, entry] of Object.entries(kit.states)) {
      it(`renders its "${id}" state, axe clean`, async () => {
        try {
          const ctx = mount(kit, entry.props);
          await entry.act?.(ctx);
          await entry.check(ctx);
          await expectAxeClean();
        } finally { cleanup(); }
      });
    }
    for (const ev of contract.events) {
      const entry = kit.events[ev.id];
      if (!entry) continue;
      it(`fires "${ev.id}" through ${ev.prop}`, async () => {
        try {
          const handler = mock.fn();
          const ctx = mount(kit, entry.props, { [ev.prop]: handler });
          await entry.act(ctx);
          assert.ok(handler.mock.callCount() >= 1, `${ev.prop} was not called`);
          entry.expect?.(handler.mock.calls.map((c) => c.arguments));
        } finally { cleanup(); }
      });
    }
    for (const [k, entry] of Object.entries(kit.keys)) {
      it(`keyboard: ${k}`, async () => {
        try {
          const ctx = mount(kit, entry.props);
          await entry.act?.(ctx);
          await entry.check(ctx);
        } finally { cleanup(); }
      });
    }
  });
}
