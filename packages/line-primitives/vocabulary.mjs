// Line primitives (roadmap item 1): the canonical vocabulary every descriptor speaks. The survey (scripts/survey.mjs)
// turns each surveyed library's prop names into these ids, the contract (contract.mjs) lists its states and events in
// them, and the coverage metric (coverage.mjs) compares the two. Pure data and pure functions: no I/O, no model.

/**
 * Canonical states: what a component can show, driven by its props. Interaction states (hover, focus-visible,
 * pressed-while-held) are styling, listed per primitive under `interaction`, not here.
 */
export const STATE_IDS = Object.freeze([
  'default', 'disabled', 'readOnly', 'required', 'invalid', 'loading', 'checked', 'indeterminate', 'selected', 'value',
  'open', 'expanded', 'pressed', 'current', 'multiple', 'dismissible', 'modal', 'empty', 'complete', 'dragOver',
  'image', 'fallback', 'sorted', 'orientation', 'interactive', 'described',
]);

/** Canonical events: what a component tells its owner. */
export const EVENT_IDS = Object.freeze([
  'press', 'change', 'inputChange', 'commit', 'openChange', 'select', 'focus', 'blur', 'remove', 'dismiss',
  'sortChange', 'selectionChange', 'submit', 'reset', 'filesChange', 'loadStatus',
]);

/**
 * Event kinds that are DOM pass-through or animation plumbing rather than behaviour. The coverage metric reports
 * them but never counts them as a loss.
 */
export const IGNORED_EVENT_KINDS = Object.freeze(['lifecycle', 'key', 'pointer', 'hover', 'other']);

/** Clusters whose "selected" boolean is a checked state (a checkbox, a switch, a toggle). */
const CHECKED_CLUSTERS = new Set(['checkbox', 'switch', 'toggle']);
/** Clusters where an onClose-style prop removes the item rather than closing a surface. */
const REMOVE_CLUSTERS = new Set(['tag']);
/** Clusters where an onClose-style prop dismisses an inline message (it has no open state to change). */
const DISMISS_CLUSTERS = new Set(['alert']);
/** Clusters whose "checked" boolean is a selected state (a checkable chip). */
const SELECTED_CLUSTERS = new Set(['tag']);

/** @type {[RegExp, string][]} Prop name -> canonical state id (first match wins). */
const STATE_RULES = [
  [/^(is)?disabled$/i, 'disabled'],
  [/^(is)?read_?only$/i, 'readOnly'],
  [/^(is)?required$|^withAsterisk$/i, 'required'],
  [/^(is)?invalid$|^error$|^hasError$|^validationState$|^errorMessage$/i, 'invalid'],
  [/^(default)?checked$/i, 'checked'],
  [/^(is)?indeterminate$/i, 'indeterminate'],
  [/^(is|default)?selected$|^selectedKeys?$|^defaultSelectedKeys?$/i, 'selected'],
  [/^(is|default)?open(ed)?$|^show$|^visible$/i, 'open'],
  [/^(is)?loading$|^isPending$|^pending$/i, 'loading'],
  [/^(is|default)?expanded(Keys)?$/i, 'expanded'],
  [/^(is|default)?pressed$/i, 'pressed'],
  [/^(is)?current$|^activePage$|^activeStep$|^active$/i, 'current'],
  [/^(is)?multiple$|^isMulti$|^selectionMode$/i, 'multiple'],
  [/^(is)?dismissi?ble$|^closable$|^withCloseButton$|^isDismissable$/i, 'dismissible'],
  [/^modal$|^isModal$/i, 'modal'],
  [/^(default)?value$|^(default)?page$|^(default)?date$/i, 'value'],
  [/^orientation$/i, 'orientation'],
];

/** @type {[RegExp, string][]} Event prop name -> canonical event id or ignored kind (first match wins). */
const EVENT_RULES = [
  [/^on(Click|Press|PressStart|PressEnd|PressChange|PressUp)$/, 'press'],
  [/^on(Action)$/, 'select'],
  [/^on(Select|ItemSelect|MenuSelect|Highlight(Change)?)$/, 'select'],
  [/^on(Input|InputChange|InputValueChange|SearchChange|Search)$/, 'inputChange'],
  [/^on(ValueCommit|ChangeEnd|ChangeEnded|ValueChangeEnd)$/, 'commit'],
  [/^on(OpenChange|Open|Close|Dismiss|Toggle|OpenChangeComplete|ExpandedChange)$/, 'openChange'],
  [/^on(Sort|SortChange|SortingChange|RequestSort|SortDescriptorChange)$/, 'sortChange'],
  [/^on(RowSelectionChange|SelectedRowsChange)$/, 'selectionChange'],
  [/^on(Change|ValueChange|CheckedChange|SelectionChange|SelectedChange|SelectedKeyChange|PageChange|StepChange|DateChange|TabChange|ActiveChange|Commit)$/, 'change'],
  [/^on(Focus|FocusChange|FocusVisibleChange|FocusIn)$/, 'focus'],
  [/^on(Blur|FocusOut)$/, 'blur'],
  [/^on(Remove|Delete|Clear)$/, 'remove'],
  [/^on(EscapeKeyDown|PointerDownOutside|InteractOutside|FocusOutside|ClickOutside)$/, 'dismiss'],
  [/^on(Submit)$/, 'submit'],
  [/^on(Reset)$/, 'reset'],
  [/^on(Drop|FileAccept|FileReject|FilesChange|FileChange|DropAccepted|DropRejected)$/, 'filesChange'],
  [/^on(LoadingStatusChange|Load|Error|StatusChange)$/, 'loadStatus'],
  [/^on(Key(Down|Up|Press))$/, 'key'],
  [/^on(Hover\w*|Mouse\w+)$/, 'hover'],
  [/^on(Pointer\w+|Touch\w+|Drag\w*)$/, 'pointer'],
  [/^on(\w*(Enter|Exit|Entered|Exited|Entering|Exiting|Transition\w*|Animation\w*|Mount|Unmount|Complete|AutoFocus))$/, 'lifecycle'],
];

/**
 * The canonical state a prop name stands for, in the context of a cluster, or null.
 * @param {string} prop A component prop name.
 * @param {string} [cluster] The cluster the component belongs to.
 * @returns {string|null} A STATE_IDS entry, or null when the prop is not a state.
 */
export function stateOf(prop, cluster) {
  for (const [re, id] of STATE_RULES) {
    if (!re.test(prop)) continue;
    if (id === 'selected' && cluster && CHECKED_CLUSTERS.has(cluster)) return 'checked';
    if (id === 'checked' && cluster && SELECTED_CLUSTERS.has(cluster)) return 'selected';
    return id;
  }
  return null;
}

/**
 * The canonical event (or ignored kind) an event prop stands for, in the context of a cluster, or null when the prop
 * is not an event prop.
 * @param {string} prop A component prop name.
 * @param {string} [cluster] The cluster the component belongs to.
 * @returns {string|null} An EVENT_IDS entry, an IGNORED_EVENT_KINDS entry, or null.
 */
export function eventOf(prop, cluster) {
  if (!/^on[A-Z]/.test(prop)) return null;
  if (cluster && REMOVE_CLUSTERS.has(cluster) && /^on(Close|Dismiss|Remove|Delete)$/.test(prop)) return 'remove';
  if (cluster && DISMISS_CLUSTERS.has(cluster) && /^on(Close|Dismiss)$/.test(prop)) return 'dismiss';
  for (const [re, id] of EVENT_RULES) if (re.test(prop)) return id;
  return 'other';
}

/**
 * Split a prop list into canonical states and events (sorted, unique), keeping the event props that only map to an
 * ignored kind apart.
 * @param {string[]} props Prop names.
 * @param {string} [cluster] The cluster, for context-dependent names.
 * @returns {{states: string[], events: string[], ignored: string[]}} The canonical descriptor.
 */
export function describeProps(props, cluster) {
  const states = new Set(['default']);
  const events = new Set();
  const ignored = new Set();
  for (const p of props) {
    const e = eventOf(p, cluster);
    if (e && IGNORED_EVENT_KINDS.includes(e)) { ignored.add(p); continue; }
    if (e) { events.add(e); continue; }
    const s = stateOf(p, cluster);
    if (s) states.add(s);
  }
  return { states: [...states].sort(), events: [...events].sort(), ignored: [...ignored].sort() };
}
