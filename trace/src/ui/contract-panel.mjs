// The UI's part of the API contract, kept out of index.html:
//   contractEmpty(c, u)      the Contract section when the example has no (usable) contract: "No contract yet" + upload
//   contractLoaded(c, u)     the top of the Contract section when there is one: file, endpoints with/without examples, gaps, upload result
//   noticeHtml(contract)     the notice at the top of a run / of the run summary
//   noContractWarn(c)        the warning next to the Start / Auto buttons
//   installContractPanel({ example, onChange, onRun, onOpen })   file picker + drag-and-drop, once
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MAX = 2 * 1024 * 1024;

const CSS = `
.ct-empty{border:1.5px dashed var(--red);background:var(--redbg);border-radius:10px;padding:10px 12px;margin-bottom:8px}
.ct-empty>b{color:var(--red);font-size:13px}.ct-empty p{margin:4px 0 0;color:var(--mut);font-size:11.5px}
.ct-drop{display:flex;flex-direction:column;align-items:center;gap:6px;border:2px dashed var(--bd);border-radius:10px;padding:14px 10px;margin:8px 0;text-align:center;background:var(--bg);transition:border-color .15s,background .15s}
.ct-drop.over{border-color:var(--acc);background:color-mix(in srgb,var(--acc) 10%,var(--bg))}.ct-drop>b{font-size:12.5px}.ct-drop span{color:var(--mut);font-size:11.5px}
.ct-drop.small{flex-direction:row;justify-content:space-between;padding:6px 10px}
.ct-err{border:1.5px solid var(--red);background:var(--redbg);color:var(--red);border-radius:8px;padding:6px 9px;margin:6px 0;font-size:12px}
.ct-ok{border:1.5px solid var(--grn);border-radius:8px;padding:6px 9px;margin:6px 0;font-size:12px}.ct-ok button{margin-top:6px}
.ct-file{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin-bottom:4px;font-size:12px}
.ct-eps{list-style:none;margin:4px 0 8px;padding:0;font-size:11.5px}.ct-eps li{display:flex;gap:6px;align-items:center;padding:2px 0;flex-wrap:wrap}
.ct-eps .ex{margin-left:auto;font-size:10.5px;color:var(--mut)}.ct-eps .ex.no{color:var(--amb);font-weight:600}
.ct-gaps{border:1.5px dashed var(--amb);background:var(--ambbg);border-radius:8px;padding:5px 9px;margin:6px 0;font-size:11.5px}.ct-gaps ul{margin:3px 0 0;padding-left:16px}
.ct-notice{border:1.5px dashed var(--red);background:var(--redbg);color:var(--red);border-radius:10px;padding:8px 10px;margin-bottom:8px;font-size:12px}.ct-notice div{color:var(--fg);margin-top:3px;font-size:11.5px}
#ncwarn{position:fixed;top:52px;right:calc(var(--dockw,460px) + 10px);z-index:999;max-width:min(520px,calc(100vw - var(--dockw,460px) - 30px));display:flex;gap:8px;align-items:center;border:1.5px solid var(--amb);background:var(--ambbg);color:var(--fg);border-radius:10px;padding:4px 10px;font-size:12px}
body.nodock #ncwarn{right:10px;max-width:calc(100vw - 20px)}#ncwarn button{padding:1px 8px;font-size:11.5px}
`;

// Per-example state of the last upload: { busy, error, result }.
const U = {};
export const uploadState = (name) => U[name] ?? {};

const dropBox = (small) => `<div class="ct-drop ${small ? "small" : ""}" data-ctdrop>${small ? `<span>Replace the contract: drop a file here or</span>` : `<b>Upload Swagger / OpenAPI</b><span>Drop a .json, .yaml or .yml file here, or</span>`}<button class="tb ${small ? "" : "go"}" data-ctpick>Choose file…</button><input type="file" data-ctfile accept=".json,.yaml,.yml,application/json,text/yaml,text/plain" hidden></div>`;

const uploadNote = (u) =>
  u.busy ? `<div class="ct-ok">Uploading…</div>`
  : u.error ? `<div class="ct-err">${esc(u.error)}</div>`
  : "";

const status = (s) => (s === "example" ? `<span class="ex">example</span>` : s === "no-example" ? `<span class="ex no">no example</span>` : `<span class="ex">no body</span>`);

// What was imported, and which parts have no example.
function endpointList(c) {
  if (!c.endpoints?.length) return "";
  return `<ul class="ct-eps">` + c.endpoints.map((e) => `<li><span class="mth ${esc(e.method)}">${esc(e.method)}</span><code>${esc(e.path)}</code>${e.request !== "none" ? `<span class="ex ${e.request === "no-example" ? "no" : ""}" title="request body">req: ${e.request === "example" ? "example" : "no example"}</span>` : ""}${e.response !== "none" ? `<span class="ex ${e.response === "no-example" ? "no" : ""}" title="response body">res: ${e.response === "example" ? "example" : "no example"}</span>` : ""}${e.wired === false ? `<span class="ex no" title="The generator calls one trailing path parameter, so this endpoint is listed but no code is generated for it.">not generated</span>` : ""}</li>`).join("") + `</ul>`;
}
const gapList = (c) => (c.gaps?.length ? `<div class="ct-gaps"><b>${c.gaps.length} gap${c.gaps.length === 1 ? "" : "s"} in the contract</b> (a gap is left open in the run, never guessed)<ul>${c.gaps.slice(0, 12).map((g) => `<li>${esc(g.text ?? g)}</li>`).join("")}${c.gaps.length > 12 ? `<li>…and ${c.gaps.length - 12} more</li>` : ""}</ul></div>` : "");

export function contractEmpty(c, u = {}) {
  const bad = c.error ? `<div class="ct-err">${esc(c.file)} can't be used: ${esc(c.error)}.</div>` : "";
  return `<div class="ct-empty"><b>${c.error ? "The contract can't be used" : "No contract yet"}</b><p>${esc(c.notice ?? "No API contract for this feature: upload a Swagger/OpenAPI file.")} The run still works: it leaves everything that needs the API open.</p></div>${bad}${uploadNote(u)}${dropBox(false)}`;
}

export function contractLoaded(c, u = {}) {
  const r = u.result;
  const noEx = (r?.endpoints ?? []).filter((e) => e.request === "no-example" || e.response === "no-example").length;
  const done = r && !u.error && !u.busy
    ? `<div class="ct-ok"><b>Imported ${esc(r.file)}:</b> ${r.endpoints.length} endpoint${r.endpoints.length === 1 ? "" : "s"}${noEx ? `, ${noEx} without an example` : ", all with examples"}.<div><button class="tb go" data-ctrun>Run again</button></div></div>`
    : "";
  return `${uploadNote(u)}${done}<div class="ct-file"><b>Contract</b><code>${esc(c.file)}</code><span style="color:var(--mut)">${c.endpoints?.length ?? 0} endpoints${c.listKey ? ` · list in <code>${esc(c.listKey)}</code>` : ""}</span></div>${endpointList(c)}${gapList(c)}${dropBox(true)}`;
}

export function noticeHtml(k) {
  if (!k) return "";
  if (k.notice) return `<div class="ct-notice"><b>${esc(k.notice)}</b><div>Until then every part that needs the API stays open, and the generated code is only stubs.</div></div>`;
  return k.gaps?.length ? `<div class="ct-gaps"><b>${k.gaps.length} gap${k.gaps.length === 1 ? "" : "s"} in the contract</b> (${esc(k.file)})<ul>${k.gaps.slice(0, 6).map((g) => `<li>${esc(g)}</li>`).join("")}${k.gaps.length > 6 ? `<li>…and ${k.gaps.length - 6} more</li>` : ""}</ul></div>` : "";
}

// The warning next to the buttons: Start, Auto and Watch stay enabled, but the run will leave everything open.
export function noContractWarn(c) {
  let el = document.getElementById("ncwarn");
  if (!c || c.hasContract) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "ncwarn";
    document.body.appendChild(el);
  }
  el.hidden = false;
  el.innerHTML = `<span>${c.error ? "The contract can't be used: the run will leave everything open until you upload a valid one." : "No contract: the run will leave everything open until you upload one."}</span><button class="tb" data-ctopen>Upload…</button>`;
}

// One set of listeners for every upload box (the boxes are re-rendered, the listeners are on the document).
export function installContractPanel({ example, onChange, onRun, onOpen }) {
  document.head.insertAdjacentHTML("beforeend", `<style>${CSS}</style>`);
  async function upload(name, file) {
    if (!file) return;
    if (file.size > MAX) { U[name] = { error: `That file is larger than ${MAX / 1024 / 1024} MB, too big for a contract.` }; return onChange(name); }
    U[name] = { busy: true };
    onChange(name);
    try {
      const text = await file.text();
      if (text.includes("\u0000")) throw new Error("That doesn't look like a text file. Upload the .json, .yaml or .yml Swagger/OpenAPI file.");
      const res = await fetch(`/api/openapi?example=${encodeURIComponent(name)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: file.name, text }) });
      const data = await res.json().catch(() => ({ error: "The server sent something unexpected." }));
      U[name] = res.ok ? { result: data } : { error: data.error ?? "The upload failed." };
    } catch (e) {
      U[name] = { error: e.message };
    }
    onChange(name);
  }
  document.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-ctpick]")) ev.target.closest("[data-ctdrop]").querySelector("[data-ctfile]").click();
    else if (ev.target.closest("[data-ctrun]")) onRun(example());
    else if (ev.target.closest("[data-ctopen]")) onOpen();
  });
  document.addEventListener("change", (ev) => {
    const input = ev.target.closest?.("[data-ctfile]");
    if (!input) return;
    upload(example(), input.files[0]);
    input.value = "";
  });
  const over = (ev, on) => {
    const zone = ev.target.closest?.("[data-ctdrop]");
    if (!zone || !ev.dataTransfer?.types?.includes("Files")) return;
    ev.preventDefault();
    zone.classList.toggle("over", on);
  };
  document.addEventListener("dragover", (ev) => over(ev, true));
  document.addEventListener("dragleave", (ev) => over(ev, false));
  document.addEventListener("drop", (ev) => {
    const zone = ev.target.closest?.("[data-ctdrop]");
    if (!zone || !ev.dataTransfer?.files?.length) return;
    ev.preventDefault();
    zone.classList.remove("over");
    upload(example(), ev.dataTransfer.files[0]);
  });
}
