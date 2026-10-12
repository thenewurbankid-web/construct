// The mock of @line/primitives (LINE-MODULE): the same exports as the real modules, answering from a tiny in-memory
// survey and two contracts, so callers (the `construct line primitives` command, createLineProject) can be tested
// without reading the 0.5 MB survey or the library folder.

/** @type {import('./contract.mjs').PrimitiveContract[]} */
export const PRIMITIVES = [
  { name: 'Button', level: 'atom', covers: ['button'], role: 'button', apg: null, radix: null, summary: 'Runs an action.', states: [{ id: 'default', means: '' }, { id: 'disabled', means: '' }], interaction: [], events: [{ id: 'press', prop: 'onClick', payload: 'MouseEvent', when: '' }], parts: ['root'], keyboard: [{ key: 'Enter', does: 'presses' }], a11y: [], props: { onClick: { type: 'function' } }, variants: {} },
  { name: 'Switch', level: 'atom', covers: ['switch'], role: 'switch', apg: null, radix: null, summary: 'On or off.', states: [{ id: 'default', means: '' }, { id: 'checked', means: '' }], interaction: [], events: [{ id: 'change', prop: 'onCheckedChange', payload: 'boolean', when: '' }], parts: ['root'], keyboard: [{ key: 'Space', does: 'toggles' }], a11y: [], props: { onCheckedChange: { type: 'function' } }, variants: {} },
];

/** A two-component held-out survey: one maps with no loss, one has no primitive. */
export const SURVEY = {
  sources: [{ id: 'held', heldOut: true }, { id: 'train', heldOut: false }],
  components: [
    { lib: 'held', name: 'Button', cluster: 'button', states: ['default', 'disabled'], events: ['press'] },
    { lib: 'held', name: 'Rating', cluster: 'rating', states: ['default'], events: ['change'] },
  ],
};

/**
 * Mock of coverage.mjs `loadSurvey`.
 * @returns {typeof SURVEY} The tiny survey.
 */
export function loadSurvey() { return SURVEY; }

/**
 * Mock of library.mjs `primitiveLibraryFiles`.
 * @returns {Record<string, string>} One component and the README.
 */
export function primitiveLibraryFiles() {
  return {
    'library/README.md': '# Library\n',
    'library/components/Button.tsx': '// @line-level atom\nexport function Button({ label }: { label: string }) {\n  return <button type="button">{label}</button>;\n}\n',
  };
}
