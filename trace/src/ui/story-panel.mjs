// The UI's part of the page story (LIN-106), kept out of demo.mjs:
//   storyEmpty(s)      "No story yet" + an "Add story" button that opens the editor
//   storyLoaded(s)     the current Goal + criteria, read-only, with an "Edit story" button
//   storyGate(s)       the run-start gate: "Draft story, please confirm" + the editor, prefilled from s.draft
//                       (the real GET /api/story/draft), with Confirm and Skip
//   installStoryPanel({ example, onChange, onSave, onSkip })   editor wiring, once
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `
.st-empty{border:1.5px dashed var(--bd);background:var(--bg);border-radius:10px;padding:10px 12px;margin-bottom:8px}
.st-empty>b{font-size:13px}.st-empty p{margin:4px 0 0;color:var(--mut);font-size:11.5px}
.st-loaded{border:1.5px solid var(--bd);border-radius:10px;padding:8px 10px;margin-bottom:8px;font-size:12px}
.st-loaded b{font-size:12.5px}.st-goal{margin:4px 0}
.st-crit{list-style:none;margin:4px 0 0;padding:0;font-size:11.5px}.st-crit li{padding:1px 0}.st-crit li:before{content:"– "}
.st-gate{border:1.5px dashed var(--amb);background:var(--ambbg);border-radius:10px;padding:10px 12px;margin-bottom:8px}
.st-gate>b{font-size:13px}.st-gate p{margin:4px 0 8px;color:var(--mut);font-size:11.5px}
.st-editor{margin-top:6px}.st-editor textarea{width:100%;min-height:54px;font:inherit;box-sizing:border-box}
.st-editor .st-critrow{display:flex;gap:6px;align-items:center;margin:4px 0}
.st-editor .st-critrow input{flex:1}
.st-editor .st-actions{display:flex;gap:8px;margin-top:8px}
.st-err{border:1.5px solid var(--red);background:var(--redbg);color:var(--red);border-radius:8px;padding:6px 9px;margin:6px 0;font-size:12px}
.st-skip-note{color:var(--mut);font-size:11.5px;margin-bottom:8px}
`;

// Per-example editor state: whether it's open, and pending field values while editing.
const E = {};
export const editorState = (name) => E[name] ?? {};

function editorHtml(story = {}) {
  const criteria = story.criteria?.length ? story.criteria : [""];
  return `<div class="st-editor">
    <label>Goal<textarea data-stgoal placeholder="As a &lt;role&gt;, I want &lt;capability&gt;, so that &lt;benefit&gt;.">${esc(story.goal ?? "")}</textarea></label>
    <div data-stcritlist>${criteria.map((c) => critRow(c)).join("")}</div>
    <button class="tb" type="button" data-staddcrit>+ Add criterion</button>
    <div class="st-actions"><button class="tb go" type="button" data-stsave>Save</button><button class="tb" type="button" data-stcancel>Cancel</button></div>
  </div>`;
}
const critRow = (value = "") => `<div class="st-critrow"><input type="text" data-stcrit value="${esc(value)}" placeholder="Acceptance criterion"><button class="tb" type="button" data-stremovecrit aria-label="Remove">×</button></div>`;

export function storyEmpty(s = {}) {
  const err = s.error ? `<div class="st-err">${esc(s.error)}</div>` : "";
  return `<div class="st-empty"><b>No story yet</b><p>Add a goal and acceptance criteria so the run can confirm it's building the right thing.</p>${err}${s.editing ? editorHtml(s.draft) : `<button class="tb" type="button" data-stadd>Add story</button>`}</div>`;
}

export function storyLoaded(s = {}) {
  const err = s.error ? `<div class="st-err">${esc(s.error)}</div>` : "";
  if (s.editing) return `<div class="st-loaded"><b>Story</b>${err}${editorHtml(s)}</div>`;
  return `<div class="st-loaded"><b>Story</b>${err}${s.goal ? `<p class="st-goal">${esc(s.goal)}</p>` : ""}${s.criteria?.length ? `<ul class="st-crit">${s.criteria.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}<button class="tb" type="button" data-stedit>Edit story</button></div>`;
}

export function storyGate(s = {}) {
  const err = s.error ? `<div class="st-err">${esc(s.error)}</div>` : "";
  return `<div class="st-gate"><b>Draft story, please confirm</b><p>The run is blocked until you confirm a story or skip it. Nothing is saved until you confirm.</p>${err}${editorHtml(s.draft)}<div class="st-actions"><button class="tb go" type="button" data-stconfirm>Confirm</button><button class="tb" type="button" data-stskip>Skip (runs without a story)</button></div></div>`;
}

function readEditor(root) {
  const goal = root.querySelector("[data-stgoal]")?.value ?? "";
  const criteria = [...root.querySelectorAll("[data-stcrit]")].map((i) => i.value).filter((v) => v.trim());
  return { goal, criteria };
}

// One set of listeners for every Story panel instance (re-rendered, listeners live on the document).
export function installStoryPanel({ example, onChange, onSave, onSkip, onConfirm }) {
  document.head.insertAdjacentHTML("beforeend", `<style>${CSS}</style>`);
  async function save(name, story) {
    E[name] = { ...E[name], busy: true };
    onChange(name);
    let ok = true;
    try {
      await onSave(name, story);
      E[name] = {};
    } catch (e) {
      ok = false;
      E[name] = { editing: true, draft: story, error: e.message };
    }
    onChange(name);
    return ok;
  }
  document.addEventListener("click", (ev) => {
    const name = example();
    if (ev.target.closest("[data-stadd]") || ev.target.closest("[data-stedit]")) {
      E[name] = { editing: true, draft: E[name]?.draft };
      onChange(name);
    } else if (ev.target.closest("[data-stcancel]")) {
      E[name] = {};
      onChange(name);
    } else if (ev.target.closest("[data-staddcrit]")) {
      ev.target.closest("[data-stcritlist]")?.insertAdjacentHTML("beforeend", critRow(""));
    } else if (ev.target.closest("[data-stremovecrit]")) {
      const row = ev.target.closest(".st-critrow");
      if (row?.parentElement?.children.length > 1) row.remove();
      else row?.querySelector("[data-stcrit]") && (row.querySelector("[data-stcrit]").value = "");
    } else if (ev.target.closest("[data-stsave]")) {
      const root = ev.target.closest(".st-editor");
      save(name, readEditor(root));
    } else if (ev.target.closest("[data-stconfirm]")) {
      const root = ev.target.closest(".st-gate");
      save(name, readEditor(root)).then((ok) => { if (ok && onConfirm) onConfirm(name); });
    } else if (ev.target.closest("[data-stskip]")) {
      onSkip(name);
    }
  });
}
