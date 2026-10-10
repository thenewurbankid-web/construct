// The ViewModel: a page's data shape (values/lists/actions/forms), decoupled from the API contract.
//
// extractParts (src/import/extract-parts.mjs) recomputes the page's shape fresh on every run from
// data-dyn/data-list/data-action markers alone — no contract involved — but its output was thrown away
// after building the "found" tree. The ViewModel persists that shape per feature (examples/<feature>/viewmodel.json)
// and lets a human add or edit fields on top of it, with or without a contract:
//
//   origin: "auto"    this run's live mirror of the page markup — replaced wholesale every run
//   origin: "manual"  hand-authored; not (or no longer) backed by markup
//   origin: "linked"  hand-edited AND currently backed by markup — the page is present but a human's
//                      edits win; re-extraction never partially refreshes a linked entry
//
// Granularity: one entry per top-level extractParts item — one per value, one per list (fields/rows/actions
// stay embedded in the list entry, as extractParts already shapes them), one per (page-level) action, one
// per form (its fields array stays embedded). `visuals` has no stable name to key against, so it always
// passes through live, unmerged and unauthored (v1).
//
// `key` is a stable id per entry, in the same style as the tree's leaf ids (src/tree/model.mjs): `value.<name>`,
// `list.<name>`, `action.<name>`, `form.<action>`.
import fs from "node:fs";
import path from "node:path";

export const VIEWMODEL_FILE = "viewmodel.json";
const COLLECTIONS = ["values", "lists", "actions", "forms"];

const withMeta = (key, data) => ({ key, origin: "auto", presentInPage: true, ...data });

// extractParts's output, relabeled entry by entry — never reimplements extraction.
function deriveEntries(extracted) {
  return {
    values: extracted.values.map((v) => withMeta(`value.${v.name}`, v)),
    lists: extracted.lists.map((l) => withMeta(`list.${l.name}`, l)),
    actions: extracted.actions.map((a) => withMeta(`action.${a.name}`, a)),
    forms: extracted.forms.map((f) => withMeta(`form.${f.action}`, f)),
  };
}

/**
 * A pure relabel of extractParts's output: every entry tagged `origin: "auto"`, `presentInPage: true`.
 * @param {ReturnType<import("./import/extract-parts.mjs").extractParts>} extracted
 * @returns {object} A fresh ViewModel with nothing manual and nothing suppressed.
 */
export function deriveViewModel(extracted) {
  return { ...deriveEntries(extracted), visuals: extracted.visuals, suppressed: [] };
}

/**
 * Merge this run's live page shape into the previous ViewModel (or start fresh when there is none yet).
 * Per key, in order: suppressed keys are skipped (tombstoned); a key newly or still auto is replaced
 * wholesale with the fresh entry; a manual key the page now also shows flips to "linked" (its hand-set
 * fields untouched); a linked key stays linked, pinned (no partial refresh). A key the page no longer
 * shows: dropped if it was auto, kept as "manual" (presentInPage: false) if it was linked, left alone if
 * it was already manual. `visuals` always passes through live, unmerged.
 *
 * @param {object|null} prevVm The previously saved ViewModel, or null when none exists yet.
 * @param {ReturnType<import("./import/extract-parts.mjs").extractParts>} extracted This run's live extraction.
 * @returns {object} The merged ViewModel.
 */
export function mergeViewModel(prevVm, extracted) {
  const fresh = deriveEntries(extracted);
  const suppressed = new Set(prevVm?.suppressed ?? []);

  const mergeOne = (prevEntries = [], freshEntries) => {
    const prevByKey = new Map(prevEntries.map((e) => [e.key, e]));
    const freshKeys = new Set(freshEntries.map((f) => f.key));
    const out = [];
    for (const f of freshEntries) {
      if (suppressed.has(f.key)) continue;
      const prev = prevByKey.get(f.key);
      if (!prev || prev.origin === "auto") out.push(f);
      else if (prev.origin === "manual") out.push({ ...prev, origin: "linked", presentInPage: true });
      else out.push({ ...prev, presentInPage: true }); // "linked": stays linked, pinned — no partial refresh
    }
    for (const prev of prevEntries) {
      if (freshKeys.has(prev.key) || suppressed.has(prev.key)) continue;
      if (prev.origin === "auto") continue; // no longer on the page, never hand-set: drop it
      if (prev.origin === "linked") out.push({ ...prev, origin: "manual", presentInPage: false }); // kept, never deleted by re-extraction
      else out.push(prev); // already manual: unaffected
    }
    return out;
  };

  return {
    values: mergeOne(prevVm?.values, fresh.values),
    lists: mergeOne(prevVm?.lists, fresh.lists),
    actions: mergeOne(prevVm?.actions, fresh.actions),
    forms: mergeOne(prevVm?.forms, fresh.forms),
    visuals: extracted.visuals,
    suppressed: [...suppressed],
  };
}

/**
 * Projects a ViewModel back down to exactly extractParts's shape (stripping key/origin/presentInPage).
 * This is the seam match.mjs consumes; match.mjs itself needs no code changes.
 * @param {object} vm A ViewModel.
 * @returns {{values:object[], lists:object[], actions:object[], forms:object[], visuals:object[]}}
 */
export function toExtractedShape(vm) {
  const strip = ({ key, origin, presentInPage, ...rest }) => rest;
  return {
    values: vm.values.map(strip),
    lists: vm.lists.map(strip),
    actions: vm.actions.map(strip),
    forms: vm.forms.map(strip),
    visuals: vm.visuals,
  };
}

/**
 * Load an example's saved ViewModel.
 *
 * @param {string} dir The example's directory.
 * @returns {object|null} The parsed `viewmodel.json`, or `null` when it does not exist or cannot be parsed.
 */
export function loadViewModel(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, VIEWMODEL_FILE), "utf8"));
  } catch {
    return null;
  }
}

// Write-if-changed, same guard as answers.json (pipeline.mjs), so watch mode doesn't self-retrigger.
/**
 * Save an example's ViewModel, only if its content actually changed (same write-if-changed guard as
 * `answers.json` in `pipeline.mjs`, so watch mode does not re-trigger itself).
 *
 * @param {string} dir The example's directory.
 * @param {object} vm The ViewModel to save.
 * @returns {void}
 */
export function saveViewModel(dir, vm) {
  const file = path.join(dir, VIEWMODEL_FILE);
  const next = JSON.stringify(vm, null, 2) + "\n";
  const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (next !== prev) fs.writeFileSync(file, next);
}

// ---------- manual edit primitives (pure vm -> vm) ----------
// For a future editing UI: thin HTTP routes over these, touching one JSON file, following the
// src/inspector/state.mjs + src/inspector/routes.mjs pattern of pure state functions behind routes.

function findEntry(vm, key) {
  for (const c of COLLECTIONS) {
    const entry = vm[c]?.find((e) => e.key === key);
    if (entry) return { collection: c, entry };
  }
  return null;
}

function upsert(list, entry) {
  const i = list.findIndex((e) => e.key === entry.key);
  if (i === -1) return [...list, entry];
  return list.map((e, idx) => (idx === i ? entry : e));
}

const manualEntry = (key, data) => ({ key, origin: "manual", presentInPage: false, ...data });
const unsuppress = (vm, key) => vm.suppressed.filter((k) => k !== key);

/**
 * Add a hand-authored value entry, not backed by page markup.
 *
 * @param {object} vm The ViewModel.
 * @param {{name: string, example: *}} value The value to add.
 * @returns {object} The updated ViewModel (a new object; `vm` is not mutated).
 */
export function addManualValue(vm, { name, example }) {
  const key = `value.${name}`;
  return { ...vm, values: upsert(vm.values, manualEntry(key, { name, example })), suppressed: unsuppress(vm, key) };
}

/**
 * Add a hand-authored list entry, not backed by page markup.
 *
 * @param {object} vm The ViewModel.
 * @param {{name: string, fields: string[], rows: object[], actions?: string[]}} list The list to add.
 * @returns {object} The updated ViewModel.
 */
export function addManualList(vm, { name, fields, rows, actions = [] }) {
  const key = `list.${name}`;
  return { ...vm, lists: upsert(vm.lists, manualEntry(key, { name, fields, rows, actions })), suppressed: unsuppress(vm, key) };
}

/**
 * Add a hand-authored page action, not backed by page markup.
 *
 * @param {object} vm The ViewModel.
 * @param {{name: string, element: string}} action The action to add.
 * @returns {object} The updated ViewModel.
 */
export function addManualAction(vm, { name, element }) {
  const key = `action.${name}`;
  return { ...vm, actions: upsert(vm.actions, manualEntry(key, { name, element })), suppressed: unsuppress(vm, key) };
}

// Adds one field to the named form's fields array, creating the form entry (manual) if it doesn't exist yet.
/**
 * Add one field to a form's fields array, creating the form entry (manual) first if it does not exist yet.
 *
 * @param {object} vm The ViewModel.
 * @param {string} formAction The form's `action` (its key is `form.<formAction>`).
 * @param {object} field The field to append.
 * @returns {object} The updated ViewModel.
 */
export function addManualFormField(vm, formAction, field) {
  const key = `form.${formAction}`;
  const base = vm.forms.find((f) => f.key === key) ?? manualEntry(key, { action: formAction, fields: [] });
  return { ...vm, forms: upsert(vm.forms, { ...base, fields: [...base.fields, field] }), suppressed: unsuppress(vm, key) };
}

// Edits any entry's fields and marks it "manual" — taking ownership, so the next merge either keeps it
// pinned (page absent) or flips it to "linked" (page still shows it, edits kept) rather than overwriting it.
/**
 * Edit any entry's fields and mark it `"manual"` — taking ownership, so the next merge either keeps it pinned
 * (page absent) or flips it to `"linked"` (page still shows it, edits kept) rather than overwriting it.
 *
 * @param {object} vm The ViewModel.
 * @param {string} key The entry's key, e.g. `"value.total"`.
 * @param {object} patch Fields to merge into the entry (`key`/`origin` are always preserved/set, not
 *   overridable via `patch`).
 * @returns {object} The updated ViewModel, or `vm` unchanged when `key` is not found.
 */
export function editEntry(vm, key, patch) {
  const found = findEntry(vm, key);
  if (!found) return vm;
  const { collection, entry } = found;
  return { ...vm, [collection]: vm[collection].map((e) => (e.key === key ? { ...e, ...patch, key: entry.key, origin: "manual" } : e)) };
}

// Tombstones a page-present field into vm.suppressed rather than deleting it, so re-merge doesn't resurrect it.
/**
 * Remove an entry, tombstoning its key into `vm.suppressed` rather than just deleting it, so a later re-merge
 * (see {@link mergeViewModel}) does not resurrect it.
 *
 * @param {object} vm The ViewModel.
 * @param {string} key The entry's key.
 * @returns {object} The updated ViewModel, or `vm` unchanged when `key` is not found.
 */
export function removeEntry(vm, key) {
  const found = findEntry(vm, key);
  if (!found) return vm;
  const { collection } = found;
  return {
    ...vm,
    [collection]: vm[collection].filter((e) => e.key !== key),
    suppressed: vm.suppressed.includes(key) ? vm.suppressed : [...vm.suppressed, key],
  };
}
