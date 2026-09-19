// Preview bridge: the tiny in-page half of click-to-source. Runs inside the
// previewed app (dev only). On click it finds the nearest element carrying a
// `data-cx-src` attribute (added by ./jsxSourceAnnotator.mjs) and posts
// `{ type: 'construct:select', src }` to the embedding Cockpit window. It sends
// nothing else and reads nothing else from the page.
//
// `installPreviewBridge` is a plain function with no closure over module scope
// so `previewBridgeScript()` can serialise it into an inline <script>, while
// tests call it directly against a fake window.
export const PREVIEW_MESSAGE_TYPE = 'construct:select';

export function installPreviewBridge(win) {
  if (win.__constructPreviewBridge || win.parent === win) return false;
  win.__constructPreviewBridge = true;
  const ATTR = 'data-cx-src';
  const find = (el) => (el && el.closest ? el.closest('[' + ATTR + ']') : null);
  let hovered = null;
  win.document.addEventListener('mouseover', (e) => {
    const t = find(e.target);
    if (hovered && hovered !== t) hovered.style.outline = hovered.__cxOutline || '';
    if (t && t !== hovered) { t.__cxOutline = t.style.outline; t.style.outline = '2px solid #7c5cff'; }
    hovered = t;
  }, true);
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
