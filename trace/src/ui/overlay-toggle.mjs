// The fit screen's Overlay toggle (LIN-104): show/hide the wires and part highlights drawn over the design, without
// touching selection, Asks or data. Pure: it runs in the browser and in node, and knows nothing about the DOM.
export const OVERLAY_KEY = "trace-overlay"; // localStorage, per viewer; "0" = off, anything else (including missing) = on

// store: { get(key), set(key, value) }, both wrapped in try/catch by the caller (see demo.mjs's `store`).
export const readOverlayOn = (store) => store.get(OVERLAY_KEY) !== "0";
export const writeOverlayOn = (store, on) => store.set(OVERLAY_KEY, on ? null : "0"); // "on" is the default: no key beats a stale one

export const overlayLabel = (on) => (on ? "Overlay" : "Overlay off");
export const overlayTitle = (on) => `${on ? "Hide" : "Show"} the wires and highlights (O)`;
