// T12.2: endpoint selection with an ASYNC Product confirm.
//
// T13 built the endpoint-CHOICE block (listCandidates/endpointChoiceHtml/installEndpointChoice/
// parseCandidateValue, src/ui/import-wizard.mjs) because T12.2 did not exist yet, and its own report says
// "T12 should adopt this rather than building its own." This file does exactly that: it imports T13's block
// unchanged and adds a confirmation gate on top. Picking a candidate and pressing "Request Product confirm" no
// longer finalizes the choice — it queues a pending request (POST /api/wizard/apply-request, wired by the
// caller) that Product must separately approve from the pending list below before feature.json actually
// changes. "Change endpoint…" returns to the picker without side effects.
// (Reused per CLAUDE.md's Construct-first rule too: checked packages/ast, core and engine — nothing there is an
// endpoint/list picker or an approval queue, so there is nothing to reuse from Construct either; T13's own
// choice block is the real reuse, and the pending-approvals list below is net-new.)
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
    `<p class="es-sub">This queues the change for Product's approval below; <code>feature.json</code>'s list override only changes once it's approved.</p>` +
    `<button class="tb go" data-esconfirm>Request Product confirm</button><button class="tb" data-eschange>Change endpoint…</button></div>`;
}

/**
 * One pending endpoint-selection request awaiting Product's approval (T12.2's async confirm — see the file
 * header). Pure render, like {@link endpointConfirmHtml}.
 *
 * @param {{example:string, method:string, path:string, key:string|null}} pending One entry from GET
 *   /api/wizard/pending's `pending` array.
 * @returns {string}
 */
export function pendingApprovalHtml(pending) {
  const target = pending.key
    ? `<code>${esc(pending.method)} ${esc(pending.path)}</code> → key <code>${esc(pending.key)}</code>`
    : `<code>${esc(pending.method)} ${esc(pending.path)}</code> (bare array)`;
  return `<div class="es-pending" data-example="${esc(pending.example)}"><b>${esc(pending.example)}</b>: ${target}` +
    `<button class="tb go" data-esapprove>Approve</button><button class="tb" data-esdiscard>Change</button></div>`;
}

const CSS = `
.es-confirm{border:1.5px dashed var(--acc);border-radius:8px;padding:8px 10px;font-size:12px}
.es-confirm p{margin:0 0 6px}.es-sub{color:var(--mut);font-size:11.5px}
.es-confirm button{margin-right:6px}
.es-pending-list{border:1.5px dashed var(--acc);border-radius:8px;padding:8px 10px;font-size:12px;margin-top:8px}
.es-pending{padding:4px 0}
.es-pending button{margin-left:6px}
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

/**
 * Mount the Asks/approvals list of every example with an endpoint-selection request pending Product's approval
 * (T12.2's async confirm — see the file header). Pure fetch/render glue: GET /api/wizard/pending lists them;
 * "Approve" applies the pending candidate for real (POST /api/wizard/apply, which also clears the pending
 * record — see import-wizard-routes.mjs); "Change" discards the pending record without applying anything
 * (POST /api/wizard/apply-request with `candidate: null`). Renders nothing when there is no pending request.
 *
 * @param {HTMLElement} root
 * @param {{onChanged?: () => void}} [opts] Called after an approve/discard so the caller can refresh its own
 *   contract view (the approved example's `listKey` just changed).
 * @returns {{refresh: () => Promise<void>}}
 */
export function installPendingApprovals(root, { onChanged } = {}) {
  if (!cssInstalled) { document.head.insertAdjacentHTML("beforeend", `<style>${CSS}</style>`); cssInstalled = true; }

  async function refresh() {
    const { pending } = await (await fetch("/api/wizard/pending")).json();
    if (!pending.length) { root.innerHTML = ""; return; }
    root.innerHTML = `<div class="es-pending-list"><b>Pending Product approval</b>${pending.map(pendingApprovalHtml).join("")}</div>`;
    const byExample = new Map(pending.map((p) => [p.example, p]));
    root.querySelectorAll("[data-example]").forEach((row) => {
      const p = byExample.get(row.dataset.example);
      if (!p) return;
      row.querySelector("[data-esapprove]")?.addEventListener("click", async () => {
        await fetch("/api/wizard/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ example: p.example, listKey: p.key }) });
        await refresh();
        onChanged?.();
      }, { once: true });
      row.querySelector("[data-esdiscard]")?.addEventListener("click", async () => {
        await fetch("/api/wizard/apply-request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ example: p.example, candidate: null }) });
        await refresh();
        onChanged?.();
      }, { once: true });
    });
  }

  refresh();
  return { refresh };
}
