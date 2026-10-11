// Find a registered control on the real page: data-line-control is its id in the one control registry
// (packages/engine/line/controls.mjs), data-line-target the item it acts on.

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
