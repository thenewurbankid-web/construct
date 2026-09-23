// Preview bridge: the tiny in-page half of click-to-source. Runs inside the
// previewed app (dev only). On click it finds the nearest element carrying a
// `data-cx-src` attribute (added by ./jsxSourceAnnotator.mjs) and posts
// `{ type: 'construct:select', src }` to the embedding Cockpit window. Two more
// messages exist so the Cockpit can tell the states of the preview apart (#378):
// `{ type: 'construct:ready' }` once, when the bridge installs (its absence, with
// the dev server answering, means the target app does not load the preview
// plugin), and `{ type: 'construct:error', message }` when the app throws an
// uncaught error or leaves a promise rejection unhandled. Nothing else is sent
// and nothing else is read from the page.
//
// `installPreviewBridge` is a plain function with no closure over module scope
// so `previewBridgeScript()` can serialise it into an inline <script>, while
// tests call it directly against a fake window.
export const PREVIEW_MESSAGE_TYPE = 'construct:select';

export function installPreviewBridge(win) {
  if (win.__constructPreviewBridge || win.parent === win) return false;
  win.__constructPreviewBridge = true;
  const ATTR = 'data-cx-src';
  win.parent.postMessage({ type: 'construct:ready' }, '*');
  if (win.addEventListener) {
    const report = (raw) => win.parent.postMessage({ type: 'construct:error', message: String(raw || 'Unknown error').slice(0, 300) }, '*');
    win.addEventListener('error', (e) => report(e && e.message));
    win.addEventListener('unhandledrejection', (e) => report((e && e.reason && e.reason.message) || (e && e.reason) || 'Unhandled promise rejection'));
  }
  const find = (el) => (el && el.closest ? el.closest('[' + ATTR + ']') : null);
  let hovered = null;
  win.document.addEventListener('mouseover', (e) => {
    const t = find(e.target);
    if (hovered && hovered !== t) hovered.style.outline = hovered.__cxOutline || '';
    if (t && t !== hovered) { t.__cxOutline = t.style.outline; t.style.outline = '2px solid #7c5cff'; }
    hovered = t;
  }, true);
  // Pointer left the document/iframe (mouseout/mouseleave with no relatedTarget):
  // no mouseover follows, so clear the outline here or it sticks.
  const clear = (e) => {
    if (e.relatedTarget || !hovered) return;
    hovered.style.outline = hovered.__cxOutline || '';
    hovered = null;
  };
  win.document.addEventListener('mouseout', clear, true);
  win.document.addEventListener('mouseleave', clear, true);
  win.document.addEventListener('click', (e) => {
    const t = find(e.target);
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    win.parent.postMessage({ type: 'construct:select', src: t.getAttribute(ATTR) }, '*');
  }, true);
  return true;
}

/** Inline-script source that installs the bridge in the page. */
export function previewBridgeScript() {
  return `(${installPreviewBridge.toString()})(window);`;
}
