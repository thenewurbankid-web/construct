// Trace and Auto on the real page: find a registered control (data-line-control, data-line-target), light it, and do
// one Auto move on it the way a person would (click, type, choose). The control's own handler does the rest, so a
// change still joins the plan through the plan API and runs only after Approve.
import type { AutoAction, LitControl } from '../types.ts';

const LIT = 'data-line-lit';

/** Whether an element is the control for `target` (a control without a target attribute fits any target). */
function fits(el: Element, target: string | null): boolean {
  if (target === null) return true;
  const t = el.getAttribute('data-line-target');
  return t === null || t === target;
}

/** Every element on the page for one registered control and its item. */
export function findControls(controlId: string, target: string | null, root: ParentNode = document): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(`[data-line-control="${controlId}"]`));
  return all.filter((el) => fits(el, target));
}

/** Light the given controls and nothing else: data-line-lit="request" or "step" (line-trace.css draws it). */
export function applyLights(lit: LitControl[], root: ParentNode = document): number {
  root.querySelectorAll(`[${LIT}]`).forEach((el) => el.removeAttribute(LIT));
  let count = 0;
  for (const c of lit) {
    for (const el of findControls(c.controlId, c.target, root)) {
      if (el.getAttribute(LIT) !== 'request') el.setAttribute(LIT, c.kind);
      count += 1;
    }
  }
  return count;
}

/** Remove every light. */
export function clearLights(root: ParentNode = document): void {
  root.querySelectorAll(`[${LIT}]`).forEach((el) => el.removeAttribute(LIT));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The control once it is on the page and usable (a form opens, parts load), or null after `timeoutMs`. */
export async function waitForControl(action: AutoAction, timeoutMs: number, cancelled: () => boolean): Promise<HTMLElement | null> {
  const end = Date.now() + timeoutMs;
  while (!cancelled()) {
    const el = findControls(action.controlId, action.target).find((e) => !(e as HTMLButtonElement).disabled || action.kind === 'approve');
    if (el) return el;
    if (Date.now() > end) return null;
    await sleep(100);
  }
  return null;
}

/** Set a React-controlled field's value the way typing does, so the screen's own onChange runs. */
function setFieldValue(el: HTMLElement, value: string, event: 'input' | 'change'): void {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event(event, { bubbles: true }));
}

/** Do one Auto move on the control (Approve is a click too; whether Auto may make it is decided before). */
export function perform(el: HTMLElement, action: AutoAction): void {
  if (action.kind === 'type') setFieldValue(el, action.value ?? '', 'input');
  else if (action.kind === 'select') setFieldValue(el, action.value ?? '', 'change');
  else el.click();
}

/** Where the simulated cursor goes for an element (its centre, in the viewport). */
export function centreOf(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height / 2),
  };
}
