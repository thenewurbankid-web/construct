// Trace on the real page: light the registered controls (data-line-lit="request" or "step"; line-trace.css draws it).
import { findControls } from './FindControls.ts';
import type { LitControl } from '../types.ts';

const LIT = 'data-line-lit';

/** Light the given controls and nothing else; answers how many elements are lit. */
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
