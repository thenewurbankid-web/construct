// T12.2: endpoint selection with Product confirm.
//
// T13 built the endpoint-CHOICE block (listCandidates/endpointChoiceHtml/installEndpointChoice/
// parseCandidateValue, src/ui/import-wizard.mjs) because T12.2 did not exist yet, and its own report says
// "T12 should adopt this rather than building its own." This file does exactly that: it imports T13's block
// unchanged and adds exactly one thing on top — a confirmation gate. Picking a candidate and pressing "Use
// this endpoint" no longer finalizes the choice; it shows what would happen and waits for an explicit
// "Product confirm" click before calling back. "Change endpoint…" returns to the picker without side effects.
// (Reused per CLAUDE.md's Construct-first rule too: checked packages/ast, core and engine — nothing there is an
// endpoint/list picker, so there is nothing to reuse from Construct either; T13's own block is the real reuse.)
import { listCandidates, endpointChoiceHtml, installEndpointChoice, parseCandidateValue, esc } from "./import-wizard.mjs";

export { listCandidates, parseCandidateValue };

/**
 * The confirmation gate shown after a candidate is picked, before it is applied. Pure render: data in, HTML
 * out, like every other step in import-wizard.mjs.
 *
 * @param {{method:string, path:string, key:string|null, value:string}} candidate The picked candidate (see
 *   {@link listCandidates}).
 * @returns {string}
 */
export function endpointConfirmHtml(candidate) {
  const target = candidate.key
    ? `<code>${esc(candidate.method)} ${esc(candidate.path)}</code> → key <code>${esc(candidate.key)}</code>`
    : `<code>${esc(candidate.method)} ${esc(candidate.path)}</code> (bare array)`;
  return `<div class="es-confirm"><p>Use ${target} as the list endpoint for this feature?</p>` +
    `<p class="es-sub">This sets <code>feature.json</code>'s list override; every part that matches against "the list" will use it from the next run on.</p>` +
    `<button class="tb go" data-esconfirm>Product confirm</button><button class="tb" data-eschange>Change endpoint…</button></div>`;
}

const CSS = `
.es-confirm{border:1.5px dashed var(--acc);border-radius:8px;padding:8px 10px;font-size:12px}
.es-confirm p{margin:0 0 6px}.es-sub{color:var(--mut);font-size:11.5px}
.es-confirm button{margin-right:6px}
`;
let cssInstalled = false;

/**
 * Mount the endpoint-choice step (T13's block, reused as-is) with a confirmation gate on top (T12.2): picking a
 * candidate and pressing "Use this endpoint" shows {@link endpointConfirmHtml} instead of finalizing; only
 * "Product confirm" calls `onConfirm`. "Change endpoint…" goes back to the picker. `root` is fully re-rendered
 * on every phase change, so mount this into its own container rather than one shared with other UI.
 *
 * @param {HTMLElement} root
 * @param {{method:string,path:string,response?:*}[]} apis The contract's endpoints, as {@link listCandidates} expects.
 * @param {string|null} listKey The contract's current pick.
 * @param {(candidate:{method:string,path:string,key:string|null,value:string}) => void} onConfirm Called once,
 *   only after "Product confirm" — never on a bare pick.
 * @returns {{refresh: (apis:object[], listKey:string|null) => void}} `refresh` re-reads the candidates (e.g.
 *   after a new contract upload) and returns to the picker phase.
 */
export function installEndpointSelect(root, apis, listKey, { onConfirm }) {
  if (!cssInstalled) { document.head.insertAdjacentHTML("beforeend", `<style>${CSS}</style>`); cssInstalled = true; }
  let candidates = listCandidates(apis, listKey);
  let chosen = null;

  function renderChoose() {
    chosen = null;
    root.innerHTML = endpointChoiceHtml(candidates, null);
    installEndpointChoice(root, { onChoose: (c) => { chosen = c; renderConfirm(); } });
  }
  function renderConfirm() {
    root.innerHTML = endpointConfirmHtml(chosen);
    root.querySelector("[data-esconfirm]").addEventListener("click", () => onConfirm(chosen), { once: true });
    root.querySelector("[data-eschange]").addEventListener("click", renderChoose, { once: true });
  }

  renderChoose();
  return { refresh: (newApis, newListKey) => { candidates = listCandidates(newApis, newListKey); renderChoose(); } };
}
