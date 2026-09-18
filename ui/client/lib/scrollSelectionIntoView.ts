// #77 follow-up to #51 (pages-editor's TreePanel.tsx/PreviewPanel.tsx) — a
// plain DOM utility, not a hook or component: no state of its own, just a
// procedure a component's own `useEffect` calls. Lives in ui/client/lib
// (alongside http.ts/apiBase.ts) rather than under a feature's components/
// directory, since that layer's own naming rule (READ-001, PascalCase file
// matching a component export) is for actual components — see ChatLog.tsx
// for this repo's existing precedent that a component may own simple
// ref+effect scroll behavior directly, per README's non-negotiable
// defaults; this just factors out the shared "is it already visible"
// procedure so two panels don't duplicate it.
//
// Only scrolls when the target isn't already fully visible within
// `container`'s own scroll area, so it never fights a user's manual scroll
// position when nothing actually needs to move.
export function scrollSelectionIntoView(container: HTMLElement | null, selectedId: string | null): void {
  if (!container || !selectedId) return;
  const target = container.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(selectedId)}"]`);
  if (!target) return;

  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const alreadyVisible =
    targetRect.top >= containerRect.top &&
    targetRect.bottom <= containerRect.bottom &&
    targetRect.left >= containerRect.left &&
    targetRect.right <= containerRect.right;
  if (alreadyVisible) return;

  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
