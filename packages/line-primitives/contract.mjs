// Line primitives (roadmap item 1): the contract of every canonical primitive. One entry per primitive says what it is
// (role and WAI-ARIA pattern), what it can show (states), what it tells its owner (events), what it is made of
// (parts), how it behaves from the keyboard, what accessibility it guarantees, its props, and the variant hook-points
// theming (roadmap item 8) plugs into. The components under library/components implement exactly this; every
// primitive's test kit (test/kits) is checked against it, state by state, event by event and key by key.
//
// Pure data and pure functions: no I/O, no model. States and events use the ids in vocabulary.mjs; `covers` names
// the survey clusters (clusters.mjs) the primitive stands for.

/**
 * @typedef {{ type: 'string'|'number'|'boolean'|'node'|'function'|'enum'|'array'|'object'|'date', required?: boolean, values?: string[], default?: unknown, doc?: string }} PropSchema
 * @typedef {{ id: string, means: string }} StateSpec
 * @typedef {{ id: string, prop: string, payload: string, when: string }} EventSpec
 * @typedef {{ key: string, does: string }} KeySpec
 * @typedef {{
 *   name: string, level: 'atom'|'molecule'|'organism', covers: string[], role: string|null, apg: string|null,
 *   summary: string, states: StateSpec[], interaction: string[], events: EventSpec[], parts: string[],
 *   keyboard: KeySpec[], a11y: string[], props: Record<string, PropSchema>, variants: Record<string, string[]>,
 *   radix: string|null,
 * }} PrimitiveContract
 */

const APG = 'https://www.w3.org/WAI/ARIA/apg/patterns/';
const st = (id, means) => ({ id, means });
const ev = (id, prop, payload, when) => ({ id, prop, payload, when });
const key = (k, does) => ({ key: k, does });
const p = (type, extra = {}) => ({ type, ...extra });
const req = (type, extra = {}) => ({ type, required: true, ...extra });
const en = (values, def) => ({ type: 'enum', values, default: def });

/** Interaction states every focusable primitive styles (Tailwind `hover:`, `focus-visible:`, `active:`). */
const POINTER = ['hover', 'focus-visible', 'active'];
/** The size and look hook-points most controls share; theming maps them to tokens later. */
const CONTROL_VARIANTS = { size: ['sm', 'md', 'lg'] };
const FIELD_A11Y = [
  'The control is named by its visible label (label/htmlFor or aria-labelledby).',
  'Help text and the error are linked with aria-describedby; the error is announced (role="alert").',
  'invalid sets aria-invalid="true"; required sets the native required attribute.',
];
const FIELD_PROPS = {
  label: req('string'), description: p('string'), error: p('string', { doc: 'Shown under the control; sets invalid.' }),
  disabled: p('boolean'), required: p('boolean'), className: p('string'),
};

/** @type {readonly PrimitiveContract[]} */
export const PRIMITIVES = Object.freeze([
  {
    name: 'Button', level: 'atom', covers: ['button', 'toggle'], role: 'button', apg: `${APG}button/`, radix: 'Slot',
    summary: 'Runs an action when pressed; can stay pressed as a toggle, or show that its action is running.',
    states: [st('default', 'Ready to press.'), st('disabled', 'Cannot be pressed; native disabled.'), st('loading', 'Its action is running: aria-busy, a spinner, presses ignored.'), st('pressed', 'A toggle that is on: aria-pressed="true".')],
    interaction: POINTER,
    events: [ev('press', 'onClick', 'MouseEvent', 'pressed by pointer, Enter or Space while enabled and not loading')],
    parts: ['root', 'icon', 'label', 'spinner'],
    keyboard: [key('Enter', 'presses the button'), key('Space', 'presses the button')],
    a11y: ['Native <button type="button"> (or the child element with asChild).', 'Accessible name from its label.', 'loading sets aria-busy="true" and aria-disabled="true".', 'pressed sets aria-pressed.'],
    props: { label: p('string'), children: p('node'), onClick: p('function'), disabled: p('boolean'), loading: p('boolean'), pressed: p('boolean', { doc: 'Makes it a toggle button.' }), icon: p('node'), asChild: p('boolean'), type: en(['button', 'submit', 'reset'], 'button'), variant: en(['primary', 'secondary', 'ghost', 'danger'], 'primary'), size: en(['sm', 'md', 'lg'], 'md'), className: p('string') },
    variants: { variant: ['primary', 'secondary', 'ghost', 'danger'], ...CONTROL_VARIANTS },
  },
  {
    name: 'IconButton', level: 'atom', covers: ['iconButton'], role: 'button', apg: `${APG}button/`, radix: null,
    summary: 'A button that shows only an icon; its name lives in aria-label.',
    states: [st('default', 'Ready to press.'), st('disabled', 'Cannot be pressed.'), st('loading', 'Its action is running.')],
    interaction: POINTER,
    events: [ev('press', 'onClick', 'MouseEvent', 'pressed by pointer, Enter or Space')],
    parts: ['root', 'icon'],
    keyboard: [key('Enter', 'presses the button'), key('Space', 'presses the button')],
    a11y: ['label is required and becomes aria-label (no visible text).', 'The icon is aria-hidden.', 'loading sets aria-busy.'],
    props: { label: req('string'), icon: req('node'), onClick: p('function'), disabled: p('boolean'), loading: p('boolean'), variant: en(['primary', 'secondary', 'ghost', 'danger'], 'ghost'), size: en(['sm', 'md', 'lg'], 'md'), className: p('string') },
    variants: { variant: ['primary', 'secondary', 'ghost', 'danger'], ...CONTROL_VARIANTS },
  },
  {
    name: 'Link', level: 'atom', covers: ['link'], role: 'link', apg: `${APG}link/`, radix: 'Slot',
    summary: 'Navigates somewhere; marks the current page and opens external links safely.',
    states: [st('default', 'A link.'), st('current', 'Points at the current page: aria-current="page".'), st('disabled', 'Not navigable: no href, aria-disabled.')],
    interaction: POINTER,
    events: [ev('press', 'onClick', 'MouseEvent', 'followed by pointer or Enter')],
    parts: ['root', 'externalIcon'],
    keyboard: [key('Enter', 'follows the link')],
    a11y: ['Native <a href> (or the child element with asChild, e.g. a router link).', 'external adds rel="noopener noreferrer", target="_blank" and an "(opens in a new tab)" hint.', 'current sets aria-current="page".'],
    props: { href: req('string'), children: req('node'), onClick: p('function'), current: p('boolean'), external: p('boolean'), disabled: p('boolean'), asChild: p('boolean'), variant: en(['inline', 'standalone'], 'inline'), className: p('string') },
    variants: { variant: ['inline', 'standalone'] },
  },
  {
    name: 'TextField', level: 'molecule', covers: ['textField'], role: 'textbox', apg: null, radix: 'Label',
    summary: 'A labelled single-line text input with help text and an error.',
    states: [st('default', 'Empty and editable.'), st('value', 'Shows a value.'), st('disabled', 'Not editable or focusable.'), st('readOnly', 'Focusable, not editable.'), st('required', 'Must be filled.'), st('invalid', 'Shows its error.'), st('described', 'Shows help text.'), st('loading', 'Its data is loading: a spinner by the label, aria-busy on the control.')],
    interaction: ['hover', 'focus-visible'],
    events: [ev('change', 'onValueChange', 'string', 'the text changes'), ev('focus', 'onFocus', 'FocusEvent', 'the input gains focus'), ev('blur', 'onBlur', 'FocusEvent', 'the input loses focus')],
    parts: ['root', 'label', 'input', 'description', 'error'],
    keyboard: [key('Tab', 'moves focus into and out of the input'), key('Type', 'edits the value')],
    a11y: FIELD_A11Y,
    props: { ...FIELD_PROPS, value: p('string'), defaultValue: p('string'), onValueChange: p('function'), onFocus: p('function'), onBlur: p('function'), readOnly: p('boolean'), placeholder: p('string'), type: en(['text', 'email', 'password', 'search', 'tel', 'url'], 'text'), name: p('string'), size: en(['sm', 'md', 'lg'], 'md'), loading: p('boolean') },
    variants: { ...CONTROL_VARIANTS },
  },
  {
    name: 'TextArea', level: 'molecule', covers: ['textArea'], role: 'textbox', apg: null, radix: 'Label',
    summary: 'A labelled multi-line text input with help text, an error and an optional character count.',
    states: [st('default', 'Empty and editable.'), st('value', 'Shows a value.'), st('disabled', 'Not editable.'), st('readOnly', 'Focusable, not editable.'), st('required', 'Must be filled.'), st('invalid', 'Shows its error.'), st('described', 'Shows help text.'), st('loading', 'Its data is loading: a spinner by the label, aria-busy on the control.')],
    interaction: ['hover', 'focus-visible'],
    events: [ev('change', 'onValueChange', 'string', 'the text changes'), ev('focus', 'onFocus', 'FocusEvent', 'gains focus'), ev('blur', 'onBlur', 'FocusEvent', 'loses focus')],
    parts: ['root', 'label', 'textarea', 'description', 'counter', 'error'],
    keyboard: [key('Tab', 'moves focus into and out of the text area'), key('Type', 'edits the value; Enter adds a line')],
    a11y: [...FIELD_A11Y, 'aria-multiline is implied by <textarea>.'],
    props: { ...FIELD_PROPS, value: p('string'), defaultValue: p('string'), onValueChange: p('function'), onFocus: p('function'), onBlur: p('function'), readOnly: p('boolean'), rows: p('number', { default: 3 }), maxLength: p('number'), placeholder: p('string'), name: p('string'), loading: p('boolean') },
    variants: { ...CONTROL_VARIANTS },
  },
  {
    name: 'Select', level: 'molecule', covers: ['select'], role: 'combobox', apg: `${APG}combobox/examples/combobox-select-only/`, radix: 'Select',
    summary: 'Pick one option from a closed list (select-only combobox).',
    states: [st('default', 'Nothing chosen; shows the placeholder.'), st('value', 'Shows the chosen option.'), st('open', 'The list is showing.'), st('disabled', 'Cannot be opened.'), st('required', 'A choice is needed.'), st('invalid', 'Shows its error.'), st('readOnly', 'Focusable but cannot change.'), st('loading', 'Its data is loading: a spinner by the label, aria-busy on the control.')],
    interaction: ['hover', 'focus-visible'],
    events: [ev('change', 'onValueChange', 'string', 'an option is chosen'), ev('openChange', 'onOpenChange', 'boolean', 'the list opens or closes')],
    parts: ['root', 'label', 'trigger', 'value', 'icon', 'content', 'item', 'itemIndicator', 'error'],
    keyboard: [key('Enter', 'opens the list; chooses the highlighted option'), key('Space', 'opens the list'), key('ArrowDown', 'opens the list; moves to the next option'), key('ArrowUp', 'moves to the previous option'), key('Escape', 'closes the list without choosing')],
    a11y: ['The trigger is role="combobox" named by the label, with aria-expanded.', 'Options are role="option" with aria-selected.', ...FIELD_A11Y.slice(1), 'readOnly sets aria-readonly on the trigger and keeps the list closed.'],
    props: { ...FIELD_PROPS, options: req('array', { doc: '{ value, label, disabled? }[]' }), value: p('string'), defaultValue: p('string'), onValueChange: p('function'), open: p('boolean'), defaultOpen: p('boolean'), onOpenChange: p('function'), placeholder: p('string'), name: p('string'), size: en(['sm', 'md', 'lg'], 'md'), readOnly: p('boolean'), loading: p('boolean') },
    variants: { ...CONTROL_VARIANTS },
  },
  {
    name: 'Combobox', level: 'molecule', covers: ['combobox'], role: 'combobox', apg: `${APG}combobox/examples/combobox-autocomplete-list/`, radix: null,
    summary: 'A text input that filters a list of options; the user types, then picks.',
    states: [st('default', 'Closed, nothing chosen.'), st('open', 'The filtered list is showing.'), st('value', 'An option is chosen.'), st('empty', 'The text matches nothing: "No results".'), st('disabled', 'Cannot be used.'), st('invalid', 'Shows its error.'), st('required', 'A choice is needed.'), st('readOnly', 'Focusable but cannot change.'), st('loading', 'Its data is loading: a spinner by the label, aria-busy on the control.')],
    interaction: ['hover', 'focus-visible'],
    events: [ev('change', 'onValueChange', 'string|null', 'an option is chosen'), ev('inputChange', 'onInputChange', 'string', 'the typed text changes'), ev('openChange', 'onOpenChange', 'boolean', 'the list opens or closes')],
    parts: ['root', 'label', 'input', 'listbox', 'option', 'empty', 'error'],
    keyboard: [key('ArrowDown', 'opens the list; highlights the next option'), key('ArrowUp', 'highlights the previous option'), key('Enter', 'chooses the highlighted option'), key('Escape', 'closes the list')],
    a11y: ['The input is role="combobox" with aria-expanded, aria-controls and aria-autocomplete="list".', 'The highlighted option is aria-activedescendant; options carry aria-selected.', ...FIELD_A11Y],
    props: { ...FIELD_PROPS, options: req('array', { doc: '{ value, label }[]' }), value: p('string'), onValueChange: p('function'), onInputChange: p('function'), onOpenChange: p('function'), placeholder: p('string'), emptyText: p('string', { default: 'No results' }), filter: p('function'), readOnly: p('boolean'), loading: p('boolean') },
    variants: { ...CONTROL_VARIANTS },
  },
  {
    name: 'Checkbox', level: 'atom', covers: ['checkbox'], role: 'checkbox', apg: `${APG}checkbox/`, radix: 'Checkbox',
    summary: 'A labelled two- or three-state check.',
    states: [st('default', 'Unchecked.'), st('checked', 'Checked: aria-checked="true".'), st('indeterminate', 'Partly checked: aria-checked="mixed".'), st('disabled', 'Cannot change.'), st('required', 'Must be checked.'), st('invalid', 'Shows its error.'), st('readOnly', 'Focusable but cannot change.'), st('value', 'Submits its value with the form when checked.')],
    interaction: POINTER,
    events: [ev('change', 'onCheckedChange', 'boolean', 'toggled by pointer or Space')],
    parts: ['root', 'box', 'indicator', 'label', 'error'],
    keyboard: [key('Space', 'toggles the check')],
    a11y: ['role="checkbox" named by its label, aria-checked true/false/mixed.', ...FIELD_A11Y.slice(1), 'readOnly sets aria-readonly and ignores toggles.'],
    props: { label: req('string'), checked: p('boolean'), defaultChecked: p('boolean'), indeterminate: p('boolean'), onCheckedChange: p('function'), disabled: p('boolean'), required: p('boolean'), error: p('string'), name: p('string'), className: p('string'), readOnly: p('boolean'), value: p('string', { default: 'on' }) },
    variants: { ...CONTROL_VARIANTS },
  },
  {
    name: 'Radio', level: 'molecule', covers: ['radio'], role: 'radiogroup', apg: `${APG}radio/`, radix: 'RadioGroup',
    summary: 'Pick exactly one of a small set of visible options (a radio group).',
    states: [st('default', 'Nothing chosen.'), st('value', 'One option chosen.'), st('disabled', 'The whole group is disabled.'), st('required', 'A choice is needed.'), st('invalid', 'Shows its error.'), st('orientation', 'Laid out vertically or horizontally.'), st('readOnly', 'Focusable but cannot change.')],
    interaction: POINTER,
    events: [ev('change', 'onValueChange', 'string', 'an option is chosen')],
    parts: ['root', 'legend', 'item', 'indicator', 'itemLabel', 'error'],
    keyboard: [key('ArrowDown', 'moves to and chooses the next option'), key('ArrowUp', 'moves to and chooses the previous option'), key('Space', 'chooses the focused option'), key('Tab', 'moves focus into the group (the chosen option) and out')],
    a11y: ['role="radiogroup" named by its legend; each option role="radio" with aria-checked.', 'Roving tabindex: one tab stop for the group.', ...FIELD_A11Y.slice(1), 'readOnly sets aria-readonly on the group and ignores choices.'],
    props: { label: req('string'), options: req('array'), value: p('string'), defaultValue: p('string'), onValueChange: p('function'), disabled: p('boolean'), required: p('boolean'), error: p('string'), orientation: en(['vertical', 'horizontal'], 'vertical'), name: p('string'), className: p('string'), readOnly: p('boolean') },
    variants: { ...CONTROL_VARIANTS },
  },
  {
    name: 'Switch', level: 'atom', covers: ['switch'], role: 'switch', apg: `${APG}switch/`, radix: 'Switch',
    summary: 'An on/off setting that applies at once.',
    states: [st('default', 'Off.'), st('checked', 'On: aria-checked="true".'), st('disabled', 'Cannot change.'), st('readOnly', 'Focusable but cannot change.'), st('value', 'Submits its value with the form when on.'), st('invalid', 'Shows its error.'), st('required', 'Must be on.')],
    interaction: POINTER,
    events: [ev('change', 'onCheckedChange', 'boolean', 'toggled by pointer, Space or Enter')],
    parts: ['root', 'thumb', 'label'],
    keyboard: [key('Space', 'toggles'), key('Enter', 'toggles')],
    a11y: ['role="switch" named by its label, aria-checked.', 'readOnly sets aria-readonly; required sets aria-required; error sets aria-invalid and is announced.'],
    props: { label: req('string'), checked: p('boolean'), defaultChecked: p('boolean'), onCheckedChange: p('function'), disabled: p('boolean'), name: p('string'), className: p('string'), readOnly: p('boolean'), value: p('string', { default: 'on' }), error: p('string'), required: p('boolean') },
    variants: { ...CONTROL_VARIANTS },
  },
  {
    name: 'Slider', level: 'atom', covers: ['slider'], role: 'slider', apg: `${APG}slider/`, radix: 'Slider',
    summary: 'Pick a number in a range by dragging or with the arrow keys.',
    states: [st('default', 'At its value.'), st('disabled', 'Cannot change.'), st('orientation', 'Horizontal or vertical.'), st('readOnly', 'Focusable but cannot change.'), st('value', 'Shows the value it is given (controlled).'), st('invalid', 'Shows its error.')],
    interaction: POINTER,
    events: [ev('change', 'onValueChange', 'number', 'the value moves'), ev('commit', 'onValueCommit', 'number', 'the user lets go or finishes a key press')],
    parts: ['root', 'label', 'track', 'range', 'thumb', 'output'],
    keyboard: [key('ArrowRight', 'increases by one step'), key('ArrowLeft', 'decreases by one step'), key('ArrowUp', 'increases by one step'), key('ArrowDown', 'decreases by one step'), key('Home', 'goes to the minimum'), key('End', 'goes to the maximum'), key('PageUp', 'increases by ten steps'), key('PageDown', 'decreases by ten steps')],
    a11y: ['The thumb is role="slider" named by the label, with aria-valuemin, aria-valuemax and aria-valuenow.', 'aria-orientation follows orientation.', 'readOnly sets aria-readonly and ignores keys and drags; error sets aria-invalid.'],
    props: { label: req('string'), value: p('number'), defaultValue: p('number'), min: p('number', { default: 0 }), max: p('number', { default: 100 }), step: p('number', { default: 1 }), onValueChange: p('function'), onValueCommit: p('function'), disabled: p('boolean'), orientation: en(['horizontal', 'vertical'], 'horizontal'), className: p('string'), readOnly: p('boolean'), error: p('string') },
    variants: { ...CONTROL_VARIANTS },
  },
  {
    name: 'DatePicker', level: 'molecule', covers: ['datePicker'], role: 'grid', apg: `${APG}dialog-modal/examples/datepicker-dialog/`, radix: 'Popover',
    summary: 'Pick a date from a calendar grid in a popover (date-fns for all date maths).',
    states: [st('default', 'No date chosen.'), st('value', 'Shows the chosen date.'), st('open', 'The calendar is showing.'), st('disabled', 'Cannot be opened.'), st('invalid', 'Shows its error.'), st('required', 'A date is needed.'), st('readOnly', 'Focusable but cannot change.'), st('loading', 'Its data is loading: a spinner by the label, aria-busy on the control.')],
    interaction: POINTER,
    events: [ev('change', 'onValueChange', 'Date', 'a day is chosen'), ev('openChange', 'onOpenChange', 'boolean', 'the calendar opens or closes')],
    parts: ['root', 'label', 'trigger', 'content', 'header', 'prevMonth', 'nextMonth', 'grid', 'day', 'error'],
    keyboard: [key('ArrowRight', 'next day'), key('ArrowLeft', 'previous day'), key('ArrowDown', 'same day next week'), key('ArrowUp', 'same day previous week'), key('PageDown', 'same day next month'), key('PageUp', 'same day previous month'), key('Home', 'first day of the week'), key('End', 'last day of the week'), key('Enter', 'chooses the focused day and closes'), key('Escape', 'closes without choosing')],
    a11y: ['The trigger names the chosen date; the calendar is role="grid" named by its month.', 'Each day is a button with its full date as name; the chosen day has aria-selected, today aria-current="date".', 'Days outside min/max are aria-disabled.', 'required is said in the label ("(required)"): the trigger is a button, which cannot carry aria-required.', FIELD_A11Y[1], 'readOnly keeps the calendar closed and says "(read only)" on the trigger.'],
    props: { ...FIELD_PROPS, value: p('date'), defaultValue: p('date'), onValueChange: p('function'), open: p('boolean'), onOpenChange: p('function'), min: p('date'), max: p('date'), placeholder: p('string', { default: 'Pick a date' }), format: p('string', { default: 'PPP' }), readOnly: p('boolean'), loading: p('boolean') },
    variants: { ...CONTROL_VARIANTS },
  },
  {
    name: 'Dialog', level: 'molecule', covers: ['dialog'], role: 'dialog', apg: `${APG}dialog-modal/`, radix: 'Dialog',
    summary: 'A modal window over the page; focus stays inside until it closes.',
    states: [st('default', 'Closed: only the trigger shows.'), st('open', 'Showing, with an overlay.'), st('modal', 'Blocks the page (default); role="alertdialog" when it asks to confirm.'), st('dismissible', 'Has a close button and closes on Escape or an overlay click (default); dismissible={false} leaves only its own actions.')],
    interaction: [],
    events: [ev('openChange', 'onOpenChange', 'boolean', 'opened by the trigger; closed by Escape, the close button or the overlay'), ev('dismiss', 'onDismiss', 'Event', 'Escape or an overlay click is about to close it; preventDefault keeps it open')],
    parts: ['root', 'trigger', 'overlay', 'content', 'title', 'description', 'body', 'footer', 'close'],
    keyboard: [key('Escape', 'closes the dialog and returns focus to the trigger'), key('Tab', 'moves focus within the dialog only')],
    a11y: ['role="dialog" (or "alertdialog") with aria-modal, named by its title, described by its description.', 'Focus moves inside on open, is trapped, and returns to the trigger on close.'],
    props: { title: req('string'), description: p('string'), trigger: p('node'), children: p('node'), footer: p('node'), open: p('boolean'), defaultOpen: p('boolean'), onOpenChange: p('function'), alert: p('boolean', { doc: 'role="alertdialog": overlay clicks do not close it.' }), closeLabel: p('string', { default: 'Close' }), size: en(['sm', 'md', 'lg'], 'md'), dismissible: p('boolean', { default: true }), onDismiss: p('function') },
    variants: { size: ['sm', 'md', 'lg'] },
  },
  {
    name: 'Drawer', level: 'molecule', covers: ['drawer'], role: 'dialog', apg: `${APG}dialog-modal/`, radix: 'Dialog',
    summary: 'A modal panel that slides in from an edge.',
    states: [st('default', 'Closed.'), st('open', 'Showing from its side.'), st('modal', 'Blocks the page.'), st('dismissible', 'Has a close button and closes on Escape or an overlay click (default).')],
    interaction: [],
    events: [ev('openChange', 'onOpenChange', 'boolean', 'opened or closed'), ev('dismiss', 'onDismiss', 'Event', 'Escape or an overlay click is about to close it; preventDefault keeps it open')],
    parts: ['root', 'trigger', 'overlay', 'content', 'title', 'description', 'body', 'close'],
    keyboard: [key('Escape', 'closes the drawer'), key('Tab', 'moves focus within the drawer only')],
    a11y: ['role="dialog" with aria-modal, named by its title.', 'Focus is trapped while open and returns to the trigger.'],
    props: { title: req('string'), description: p('string'), trigger: p('node'), children: p('node'), open: p('boolean'), defaultOpen: p('boolean'), onOpenChange: p('function'), side: en(['left', 'right', 'top', 'bottom'], 'right'), closeLabel: p('string', { default: 'Close' }), dismissible: p('boolean', { default: true }), onDismiss: p('function') },
    variants: { side: ['left', 'right', 'top', 'bottom'], size: ['sm', 'md', 'lg'] },
  },
  {
    name: 'Popover', level: 'molecule', covers: ['popover'], role: 'dialog', apg: null, radix: 'Popover',
    summary: 'Non-modal floating content anchored to a trigger.',
    states: [st('default', 'Closed.'), st('open', 'Showing next to its trigger.'), st('disabled', 'The trigger is disabled; it never opens.')],
    interaction: [],
    events: [ev('openChange', 'onOpenChange', 'boolean', 'opened by the trigger; closed by Escape, an outside click or the close button'), ev('dismiss', 'onDismiss', 'Event', 'Escape or an outside click is about to close it; preventDefault keeps it open')],
    parts: ['root', 'trigger', 'content', 'arrow', 'close'],
    keyboard: [key('Enter', 'on the trigger: opens'), key('Escape', 'closes and returns focus to the trigger')],
    a11y: ['The trigger has aria-expanded and aria-controls; the content is role="dialog" named by label.'],
    props: { label: req('string', { doc: 'Names the popover content.' }), trigger: req('node'), children: req('node'), open: p('boolean'), defaultOpen: p('boolean'), onOpenChange: p('function'), side: en(['top', 'right', 'bottom', 'left'], 'bottom'), disabled: p('boolean'), onDismiss: p('function') },
    variants: { side: ['top', 'right', 'bottom', 'left'] },
  },
  {
    name: 'Tooltip', level: 'atom', covers: ['tooltip'], role: 'tooltip', apg: `${APG}tooltip/`, radix: 'Tooltip',
    summary: 'A short description of a control, shown on hover or focus.',
    states: [st('default', 'Hidden.'), st('open', 'Showing.'), st('disabled', 'Never shows.')],
    interaction: [],
    events: [ev('openChange', 'onOpenChange', 'boolean', 'shown on hover or focus, hidden on leave, blur or Escape')],
    parts: ['provider', 'trigger', 'content', 'arrow'],
    keyboard: [key('Tab', 'focusing the trigger shows the tooltip'), key('Escape', 'hides it')],
    a11y: ['role="tooltip"; the trigger is described by it (aria-describedby).', 'Never holds interactive content.'],
    props: { content: req('string'), children: req('node'), open: p('boolean'), defaultOpen: p('boolean'), onOpenChange: p('function'), side: en(['top', 'right', 'bottom', 'left'], 'top'), delayDuration: p('number', { default: 300 }), disabled: p('boolean') },
    variants: { side: ['top', 'right', 'bottom', 'left'] },
  },
  {
    name: 'Menu', level: 'molecule', covers: ['menu'], role: 'menu', apg: `${APG}menu-button/`, radix: 'DropdownMenu',
    summary: 'A list of actions opened from a button.',
    states: [st('default', 'Closed.'), st('open', 'The menu is showing.'), st('disabled', 'One or more items cannot be chosen.'), st('checked', 'A checkbox item is on (menuitemcheckbox, aria-checked).')],
    interaction: ['hover', 'focus-visible'],
    events: [ev('select', 'onSelect', 'string', 'an item is chosen'), ev('openChange', 'onOpenChange', 'boolean', 'the menu opens or closes'), ev('change', 'onCheckedChange', '(id, checked)', 'a checkbox item is toggled'), ev('dismiss', 'onDismiss', 'Event', 'Escape or an outside click is about to close it; preventDefault keeps it open')],
    parts: ['root', 'trigger', 'content', 'item', 'separator', 'label'],
    keyboard: [key('Enter', 'on the trigger: opens; on an item: chooses it'), key('Space', 'on the trigger: opens'), key('ArrowDown', 'opens; moves to the next item'), key('ArrowUp', 'moves to the previous item'), key('Escape', 'closes and returns focus to the trigger')],
    a11y: ['The trigger has aria-haspopup="menu" and aria-expanded.', 'role="menu" with role="menuitem" items; disabled items have aria-disabled.', 'Items with checked are role="menuitemcheckbox" with aria-checked.'],
    props: { label: req('string', { doc: 'The trigger text.' }), items: req('array', { doc: '{ id, label, disabled?, danger? }[]' }), onSelect: p('function'), open: p('boolean'), onOpenChange: p('function'), onCheckedChange: p('function'), onDismiss: p('function') },
    variants: { size: ['sm', 'md'] },
  },
  {
    name: 'Tabs', level: 'molecule', covers: ['tabs'], role: 'tablist', apg: `${APG}tabs/`, radix: 'Tabs',
    summary: 'Switch between panels of content.',
    states: [st('default', 'The first tab selected.'), st('selected', 'A given tab selected: aria-selected="true".'), st('disabled', 'A tab cannot be selected.'), st('orientation', 'Horizontal or vertical tab list.'), st('value', 'Shows the tab it is given (controlled).')],
    interaction: POINTER,
    events: [ev('change', 'onValueChange', 'string', 'another tab is selected')],
    parts: ['root', 'list', 'trigger', 'panel'],
    keyboard: [key('ArrowRight', 'selects the next tab'), key('ArrowLeft', 'selects the previous tab'), key('Home', 'selects the first tab'), key('End', 'selects the last tab')],
    a11y: ['role="tablist" named by label; role="tab" with aria-selected and aria-controls; role="tabpanel" labelled by its tab.', 'Roving tabindex: one tab stop for the list.'],
    props: { label: req('string'), tabs: req('array', { doc: '{ value, label, content, disabled? }[]' }), value: p('string'), defaultValue: p('string'), onValueChange: p('function'), orientation: en(['horizontal', 'vertical'], 'horizontal') },
    variants: { variant: ['line', 'pill'] },
  },
  {
    name: 'Accordion', level: 'molecule', covers: ['accordion'], role: 'button', apg: `${APG}accordion/`, radix: 'Accordion',
    summary: 'Sections whose bodies expand and collapse.',
    states: [st('default', 'All sections collapsed.'), st('expanded', 'A section open: aria-expanded="true".'), st('multiple', 'Several sections can be open at once.'), st('disabled', 'A section cannot toggle.'), st('value', 'Opens the sections it is given (controlled).')],
    interaction: POINTER,
    events: [ev('change', 'onValueChange', 'string[]', 'sections open or close')],
    parts: ['root', 'item', 'header', 'trigger', 'content'],
    keyboard: [key('Enter', 'toggles the focused section'), key('Space', 'toggles the focused section'), key('ArrowDown', 'moves to the next header'), key('ArrowUp', 'moves to the previous header'), key('Home', 'first header'), key('End', 'last header')],
    a11y: ['Each header is a heading holding a button with aria-expanded and aria-controls.', 'Each body is a region labelled by its header.'],
    props: { items: req('array', { doc: '{ value, title, content, disabled? }[]' }), value: p('array'), defaultValue: p('array'), onValueChange: p('function'), multiple: p('boolean') },
    variants: { variant: ['plain', 'boxed'] },
  },
  {
    name: 'Toast', level: 'molecule', covers: ['toast'], role: 'status', apg: `${APG}alert/`, radix: 'Toast',
    summary: 'A short, temporary message about something that happened, with an optional action.',
    states: [st('default', 'Not showing.'), st('open', 'Showing in the viewport.'), st('dismissible', 'Has a close button.')],
    interaction: ['hover', 'focus-visible'],
    events: [ev('openChange', 'onOpenChange', 'boolean', 'shows, times out, is swiped or closed'), ev('press', 'onAction', 'void', 'its action button is pressed')],
    parts: ['provider', 'viewport', 'root', 'title', 'description', 'action', 'close'],
    keyboard: [key('F8', 'moves focus to the toast viewport'), key('Escape', 'dismisses the focused toast')],
    a11y: ['Announced politely (role="status"), assertively for variant="error".', 'The viewport is a labelled region reachable with F8; the action has an alternative text.'],
    props: { title: req('string'), description: p('string'), open: p('boolean'), defaultOpen: p('boolean'), onOpenChange: p('function'), actionLabel: p('string'), onAction: p('function'), duration: p('number', { default: 5000 }), variant: en(['info', 'success', 'error'], 'info') },
    variants: { variant: ['info', 'success', 'error'] },
  },
  {
    name: 'Alert', level: 'atom', covers: ['alert'], role: 'alert', apg: `${APG}alert/`, radix: null,
    summary: 'An inline message that draws attention, optionally dismissible.',
    states: [st('default', 'Showing its message.'), st('dismissible', 'Has a close button.')],
    interaction: [],
    events: [ev('dismiss', 'onDismiss', 'void', 'the close button is pressed')],
    parts: ['root', 'icon', 'title', 'description', 'close'],
    keyboard: [key('Enter', 'on the close button: dismisses')],
    a11y: ['role="alert" for warning and error, role="status" for info and success.', 'The close button is named "Dismiss".'],
    props: { title: req('string'), children: p('node'), variant: en(['info', 'success', 'warning', 'error'], 'info'), onDismiss: p('function') },
    variants: { variant: ['info', 'success', 'warning', 'error'] },
  },
  {
    name: 'Badge', level: 'atom', covers: ['badge'], role: null, apg: null, radix: null,
    summary: 'A small label for a count or a status.',
    states: [st('default', 'Shows its text.')],
    interaction: [],
    events: [],
    parts: ['root', 'dot'],
    keyboard: [],
    a11y: ['Plain text; a colour never carries meaning alone (the text says it).'],
    props: { children: req('node'), variant: en(['neutral', 'info', 'success', 'warning', 'error'], 'neutral'), dot: p('boolean') },
    variants: { variant: ['neutral', 'info', 'success', 'warning', 'error'], size: ['sm', 'md'] },
  },
  {
    name: 'Avatar', level: 'atom', covers: ['avatar'], role: 'img', apg: null, radix: null,
    summary: 'A picture of a person or entity, falling back to initials.',
    states: [st('default', 'Initials (no picture given).'), st('image', 'Shows the picture.'), st('fallback', 'The picture failed: shows initials.')],
    interaction: [],
    events: [ev('loadStatus', 'onLoadingStatusChange', "'loaded'|'error'", 'the picture loads or fails')],
    parts: ['root', 'image', 'fallback'],
    keyboard: [],
    a11y: ['The root is role="img" named by name; the picture and the initials are hidden from assistive tech.'],
    props: { name: req('string'), src: p('string'), onLoadingStatusChange: p('function'), size: en(['sm', 'md', 'lg'], 'md') },
    variants: { size: ['sm', 'md', 'lg'], shape: ['circle', 'square'] },
  },
  {
    name: 'Card', level: 'molecule', covers: ['card'], role: null, apg: null, radix: null,
    summary: 'A framed group of related content; optionally one big pressable target.',
    states: [st('default', 'A static card.'), st('interactive', 'The whole card is pressable (its title is the button).'), st('selected', 'Marked as chosen: aria-current or aria-pressed.')],
    interaction: ['hover', 'focus-visible'],
    events: [ev('press', 'onPress', 'void', 'an interactive card is pressed')],
    parts: ['root', 'header', 'title', 'description', 'body', 'footer'],
    keyboard: [key('Enter', 'presses an interactive card')],
    a11y: ['A <section> labelled by its title; an interactive card puts a button in the title, so the name stays the title.'],
    props: { title: req('string'), description: p('string'), children: p('node'), footer: p('node'), onPress: p('function'), selected: p('boolean') },
    variants: { variant: ['outline', 'elevated'] },
  },
  {
    name: 'Table', level: 'molecule', covers: ['table'], role: 'table', apg: `${APG}table/`, radix: null,
    summary: 'Rows and columns of data with sorting, row selection, loading and empty states.',
    states: [st('default', 'Shows rows.'), st('empty', 'No rows: shows the empty message.'), st('loading', 'Rows are loading: aria-busy.'), st('sorted', 'Sorted by a column: aria-sort.'), st('selected', 'Rows can be checked; checked rows have aria-selected.')],
    interaction: ['hover'],
    events: [ev('sortChange', 'onSortChange', '{ column, direction }', 'a sortable header is pressed'), ev('selectionChange', 'onSelectionChange', 'string[]', 'row checks change')],
    parts: ['root', 'caption', 'header', 'headerCell', 'sortButton', 'body', 'row', 'cell', 'selectCell', 'empty'],
    keyboard: [key('Enter', 'on a sortable header: sorts'), key('Space', 'on a row check: toggles it')],
    a11y: ['A native <table> with a caption; sortable headers hold a button and carry aria-sort.', 'Row checks are named "Select <row>".'],
    props: { caption: req('string'), columns: req('array', { doc: '{ key, header, sortable? }[]' }), rows: req('array', { doc: '{ id, ...cells }[]' }), sort: p('object'), onSortChange: p('function'), selectable: p('boolean'), selected: p('array'), onSelectionChange: p('function'), loading: p('boolean'), emptyText: p('string', { default: 'Nothing to show yet.' }) },
    variants: { density: ['compact', 'comfortable'] },
  },
  {
    name: 'Pagination', level: 'molecule', covers: ['pagination'], role: 'navigation', apg: null, radix: null,
    summary: 'Move between pages of results.',
    states: [st('default', 'On a middle page.'), st('current', 'The current page is marked aria-current="page".'), st('disabled', 'Previous is disabled on the first page, Next on the last.'), st('value', 'Shows the page it is given (always controlled).')],
    interaction: POINTER,
    events: [ev('change', 'onPageChange', 'number', 'another page is chosen')],
    parts: ['root', 'previous', 'page', 'ellipsis', 'next'],
    keyboard: [key('Enter', 'goes to the focused page'), key('Tab', 'moves between page buttons')],
    a11y: ['A <nav> named "Pagination"; page buttons are named "Page N"; the current one has aria-current="page".'],
    props: { page: req('number'), pageCount: req('number'), onPageChange: p('function'), siblings: p('number', { default: 1 }) },
    variants: { size: ['sm', 'md'] },
  },
  {
    name: 'Breadcrumbs', level: 'molecule', covers: ['breadcrumbs'], role: 'navigation', apg: `${APG}breadcrumb/`, radix: null,
    summary: 'The path to the current page.',
    states: [st('default', 'Shows the path.'), st('current', 'The last item is the current page: aria-current="page", not a link.')],
    interaction: ['hover', 'focus-visible'],
    events: [ev('press', 'onNavigate', 'string', 'a crumb is followed')],
    parts: ['root', 'list', 'item', 'link', 'separator', 'current'],
    keyboard: [key('Enter', 'follows the focused crumb')],
    a11y: ['A <nav aria-label="Breadcrumb"> with an ordered list; separators are aria-hidden.'],
    props: { items: req('array', { doc: '{ label, href }[]; the last is the current page' }), onNavigate: p('function') },
    variants: {},
  },
  {
    name: 'Progress', level: 'atom', covers: ['progress'], role: 'progressbar', apg: null, radix: 'Progress',
    summary: 'How far a task has got.',
    states: [st('default', 'Part way: aria-valuenow.'), st('loading', 'Indeterminate: no value known.'), st('complete', 'Done: value equals max.'), st('value', 'Shows the value it is given, out of max.')],
    interaction: [],
    events: [],
    parts: ['root', 'label', 'track', 'indicator', 'valueText'],
    keyboard: [],
    a11y: ['role="progressbar" named by its label, with aria-valuemin, aria-valuemax, aria-valuenow (absent while indeterminate).'],
    props: { label: req('string'), value: p('number', { doc: 'null or undefined: indeterminate' }), max: p('number', { default: 100 }), showValue: p('boolean') },
    variants: { size: ['sm', 'md'], tone: ['brand', 'success', 'error'] },
  },
  {
    name: 'Spinner', level: 'atom', covers: ['spinner'], role: 'status', apg: null, radix: null,
    summary: 'Something is loading and no amount is known.',
    states: [st('default', 'Spinning with its label for screen readers.')],
    interaction: [],
    events: [],
    parts: ['root', 'icon', 'label'],
    keyboard: [],
    a11y: ['role="status" with a visually hidden label (default "Loading").', 'The animation respects prefers-reduced-motion.'],
    props: { label: p('string', { default: 'Loading' }), size: en(['sm', 'md', 'lg'], 'md') },
    variants: { size: ['sm', 'md', 'lg'] },
  },
  {
    name: 'Skeleton', level: 'atom', covers: ['skeleton'], role: null, apg: null, radix: null,
    summary: 'A placeholder shaped like the content that is loading.',
    states: [st('default', 'Placeholder lines.'), st('loading', 'Hides its children while loading; shows them after.')],
    interaction: [],
    events: [],
    parts: ['root', 'line'],
    keyboard: [],
    a11y: ['Placeholders are aria-hidden; the wrapper has aria-busy while loading.'],
    props: { loading: p('boolean', { default: true }), lines: p('number', { default: 3 }), children: p('node'), shape: en(['text', 'circle', 'rect'], 'text') },
    variants: { shape: ['text', 'circle', 'rect'] },
  },
  {
    name: 'EmptyState', level: 'molecule', covers: ['emptyState'], role: null, apg: null, radix: null,
    summary: 'What to show when there is nothing yet, with the next thing to do.',
    states: [st('default', 'A title and a description.'), st('interactive', 'Offers an action button.')],
    interaction: [],
    events: [ev('press', 'onAction', 'void', 'the action is pressed')],
    parts: ['root', 'icon', 'title', 'description', 'action'],
    keyboard: [key('Enter', 'on the action: presses it')],
    a11y: ['A <section> labelled by its title; the icon is aria-hidden.'],
    props: { title: req('string'), description: p('string'), icon: p('node'), actionLabel: p('string'), onAction: p('function') },
    variants: { size: ['sm', 'md'] },
  },
  {
    name: 'Form', level: 'molecule', covers: ['form'], role: 'form', apg: null, radix: null,
    summary: 'A set of fields submitted together, with a submitting state and a form-level error.',
    states: [st('default', 'Ready.'), st('loading', 'Submitting: the fieldset is disabled and aria-busy.'), st('invalid', 'Shows a form-level error.')],
    interaction: [],
    events: [ev('submit', 'onSubmit', 'Record<string, FormDataEntryValue>', 'submitted by the submit button or Enter in a field'), ev('reset', 'onReset', 'void', 'the reset button is pressed')],
    parts: ['root', 'fieldset', 'error', 'actions', 'submit'],
    keyboard: [key('Enter', 'in a text field: submits the form')],
    a11y: ['A <form> named by its label; the form error has role="alert".', 'Native validation stays on (noValidate off) unless asked.'],
    props: { label: req('string'), children: req('node'), onSubmit: p('function'), onReset: p('function'), submitting: p('boolean'), error: p('string'), submitLabel: p('string', { default: 'Submit' }), resetLabel: p('string') },
    variants: { layout: ['stacked', 'inline'] },
  },
  {
    name: 'Field', level: 'atom', covers: ['field'], role: 'group', apg: null, radix: 'Label',
    summary: 'Wires a label, any control, help text and an error together (FieldError included).',
    states: [st('default', 'Label and control.'), st('described', 'Shows help text.'), st('invalid', 'Shows its error; the control gets aria-invalid.'), st('required', 'Marks the label and the control required.'), st('disabled', 'The control is disabled.'), st('readOnly', 'Focusable but cannot change.'), st('loading', 'Its data is loading: a spinner by the label, aria-busy on the control.')],
    interaction: [],
    events: [],
    parts: ['root', 'label', 'control', 'description', 'error'],
    keyboard: [],
    a11y: FIELD_A11Y,
    props: { label: req('string'), children: req('function', { doc: '(controlProps) => ReactNode: spread controlProps onto the control' }), description: p('string'), error: p('string'), required: p('boolean'), disabled: p('boolean'), readOnly: p('boolean'), loading: p('boolean') },
    variants: {},
  },
  {
    name: 'Stepper', level: 'molecule', covers: ['stepper'], role: 'list', apg: null, radix: null,
    summary: 'Where the user is in a multi-step flow; finished steps can be revisited.',
    states: [st('default', 'At the first step.'), st('current', 'A step is current: aria-current="step".'), st('complete', 'Earlier steps are marked done.'), st('value', 'Shows the step it is given (always controlled).')],
    interaction: ['hover', 'focus-visible'],
    events: [ev('change', 'onStepChange', 'number', 'a finished step is chosen')],
    parts: ['root', 'step', 'indicator', 'label', 'connector'],
    keyboard: [key('Enter', 'on a finished step: goes back to it')],
    a11y: ['An ordered list named by label; the current step has aria-current="step"; finished steps say "completed".'],
    props: { label: req('string'), steps: req('array', { doc: '{ label }[]' }), current: req('number'), onStepChange: p('function') },
    variants: { orientation: ['horizontal', 'vertical'] },
  },
  {
    name: 'FileUpload', level: 'molecule', covers: ['fileUpload'], role: 'button', apg: null, radix: null,
    summary: 'Pick or drop files; lists them with remove buttons.',
    states: [st('default', 'No files.'), st('value', 'Lists the chosen files.'), st('dragOver', 'Files are dragged over the drop zone.'), st('disabled', 'Cannot pick or drop.'), st('invalid', 'Shows its error.'), st('multiple', 'Accepts several files.'), st('readOnly', 'Focusable but cannot change.'), st('required', 'A file is needed.')],
    interaction: ['hover', 'focus-visible'],
    events: [ev('filesChange', 'onFilesChange', 'File[]', 'files are picked, dropped or removed'), ev('remove', 'onRemove', 'File', 'a listed file is removed')],
    parts: ['root', 'label', 'dropzone', 'input', 'trigger', 'list', 'item', 'remove', 'error'],
    keyboard: [key('Enter', 'on the trigger: opens the file picker'), key('Space', 'on the trigger: opens the file picker')],
    a11y: ['The trigger is a button named by the label; the file input is visually hidden but labelled.', 'Each remove button is named "Remove <file>".', ...FIELD_A11Y.slice(1), 'readOnly lists the files without the pick and remove buttons.'],
    props: { label: req('string'), accept: p('string'), multiple: p('boolean'), files: p('array'), onFilesChange: p('function'), onRemove: p('function'), disabled: p('boolean'), error: p('string'), description: p('string'), readOnly: p('boolean'), required: p('boolean') },
    variants: {},
  },
  {
    name: 'Tag', level: 'atom', covers: ['tag'], role: null, apg: null, radix: null,
    summary: 'A small token that can be selected or removed.',
    states: [st('default', 'A static token.'), st('selected', 'A toggle token that is on (aria-pressed).'), st('dismissible', 'Has a remove button.'), st('disabled', 'Cannot be pressed or removed.')],
    interaction: POINTER,
    events: [ev('remove', 'onRemove', 'void', 'its remove button is pressed, or Backspace/Delete on it'), ev('press', 'onPress', 'void', 'a selectable tag is pressed'), ev('change', 'onSelectedChange', 'boolean', 'a selectable tag is toggled (the chip pattern)')],
    parts: ['root', 'label', 'remove'],
    keyboard: [key('Backspace', 'removes a removable tag'), key('Delete', 'removes a removable tag'), key('Enter', 'presses a selectable tag')],
    a11y: ['The remove button is named "Remove <label>".', 'A selectable tag is a toggle button with aria-pressed.'],
    props: { label: req('string'), onRemove: p('function'), onPress: p('function'), selected: p('boolean'), disabled: p('boolean'), variant: en(['neutral', 'brand'], 'neutral'), onSelectedChange: p('function') },
    variants: { variant: ['neutral', 'brand'], size: ['sm', 'md'] },
  },
  {
    name: 'Text', level: 'atom', covers: ['typography'], role: null, apg: null, radix: null,
    summary: 'Text with the element its meaning needs (heading, paragraph, inline code, key, highlight, quote) and a look from tokens.',
    states: [st('default', 'A paragraph in the body style; any element, size and tone.')],
    interaction: [],
    events: [],
    parts: ['root'],
    keyboard: [],
    a11y: ['The element carries the meaning: h1-h6 for headings (in order), code, kbd, mark, blockquote and q keep their semantics; size and tone never stand in for structure.'],
    props: { children: req('node'), as: en(['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'code', 'kbd', 'mark', 'blockquote', 'q', 'small'], 'p'), size: en(['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']), tone: en(['default', 'muted', 'brand', 'success', 'warning', 'error'], 'default'), truncate: p('boolean'), className: p('string') },
    variants: { size: ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'], tone: ['default', 'muted', 'brand', 'success', 'warning', 'error'] },
  },
  {
    name: 'Divider', level: 'atom', covers: ['divider'], role: 'separator', apg: null, radix: 'Separator',
    summary: 'A line between groups of content.',
    states: [st('default', 'Horizontal and decorative.'), st('orientation', 'Vertical, or semantic (role="separator").')],
    interaction: [],
    events: [],
    parts: ['root'],
    keyboard: [],
    a11y: ['Decorative by default (role="none"); decorative={false} makes it role="separator" with aria-orientation.'],
    props: { orientation: en(['horizontal', 'vertical'], 'horizontal'), decorative: p('boolean', { default: true }) },
    variants: {},
  },
  {
    name: 'Stack', level: 'atom', covers: ['stack'], role: null, apg: null, radix: 'Slot',
    summary: 'Lays children out in a row or a column with a gap.',
    states: [st('default', 'A column.'), st('orientation', 'A row (direction="row").')],
    interaction: [],
    events: [],
    parts: ['root'],
    keyboard: [],
    a11y: ['Adds no roles; as="ul"/"ol"/"nav"/"section" keeps semantics when the content is a list or a region.'],
    props: { children: req('node'), direction: en(['column', 'row'], 'column'), gap: en(['0', '1', '2', '3', '4', '6', '8'], '4'), align: en(['start', 'center', 'end', 'stretch'], 'stretch'), justify: en(['start', 'center', 'end', 'between'], 'start'), wrap: p('boolean'), as: en(['div', 'section', 'ul', 'ol', 'nav'], 'div') },
    variants: { gap: ['0', '1', '2', '3', '4', '6', '8'] },
  },
  {
    name: 'Grid', level: 'atom', covers: ['grid'], role: null, apg: null, radix: null,
    summary: 'Lays children out in responsive columns.',
    states: [st('default', 'Fixed columns.')],
    interaction: [],
    events: [],
    parts: ['root'],
    keyboard: [],
    a11y: ['Adds no roles; as="ul" keeps list semantics.'],
    props: { children: req('node'), columns: en(['1', '2', '3', '4', '6', '12'], '3'), gap: en(['0', '2', '4', '6', '8'], '4'), as: en(['div', 'ul', 'section'], 'div') },
    variants: { columns: ['1', '2', '3', '4', '6', '12'], gap: ['0', '2', '4', '6', '8'] },
  },
]);

/** The primitive names, in contract order. */
export const PRIMITIVE_NAMES = Object.freeze(PRIMITIVES.map((x) => x.name));

/**
 * One primitive's contract by name.
 * @param {string} name A primitive name, e.g. "Button".
 * @returns {PrimitiveContract|null} The contract, or null when there is no such primitive.
 */
export function primitive(name) {
  return PRIMITIVES.find((x) => x.name === name) ?? null;
}

/**
 * The primitive standing for a survey cluster, or null when the core set does not cover it yet.
 * @param {string} clusterId A clusters.mjs id.
 * @returns {PrimitiveContract|null} The covering primitive.
 */
export function primitiveForCluster(clusterId) {
  return PRIMITIVES.find((x) => x.covers.includes(clusterId)) ?? null;
}

/**
 * The structural problems in a contract list (ids outside the vocabulary, duplicate names, events without a prop),
 * as plain sentences; empty when it is sound.
 * @param {readonly PrimitiveContract[]} list The contracts.
 * @param {{STATE_IDS: readonly string[], EVENT_IDS: readonly string[]}} vocab The vocabulary.
 * @returns {string[]} The problems.
 */
export function contractProblems(list, vocab) {
  const out = [];
  const seen = new Set();
  for (const c of list) {
    if (seen.has(c.name)) out.push(`${c.name} is listed twice.`);
    seen.add(c.name);
    for (const s of c.states) if (!vocab.STATE_IDS.includes(s.id)) out.push(`${c.name} has the state "${s.id}", which is not in the vocabulary.`);
    for (const e of c.events) {
      if (!vocab.EVENT_IDS.includes(e.id)) out.push(`${c.name} has the event "${e.id}", which is not in the vocabulary.`);
      if (!c.props[e.prop]) out.push(`${c.name} fires ${e.id} through ${e.prop}, which is not in its props.`);
    }
    if (!c.states.some((s) => s.id === 'default')) out.push(`${c.name} has no default state.`);
  }
  return out;
}
