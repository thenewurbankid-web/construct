// im3 + "What Line knows" Memory tab -- how a remembered option reads in plain words. Pure (no fs, no network), so the
// drafter's "you picked ..." sentence and the Memory tab say the same thing (the Cockpit's mirror is checked against
// this table by ui/client/features/line-knows-memory/domain/MemoryTab.spec.mjs).

/** How a route template reads in a "you picked ..." sentence. */
export const TEMPLATE_PHRASE = Object.freeze({
  'via-library': 'via the library', 'base-on': 'a new item based on the library', promote: 'moving it into the library', 'set-base': 'setting its base',
  'set-prop': 'setting the page value', 'set-fragment': 'editing that piece of code', fix: 'that fix', 'fix-all': 'fixing them all', combo: 'that combined route',
  'new-feature': 'starting a new feature', 'create-layout': 'creating the layout',
});

/**
 * The phrase for a route key ("via-library:ui:C>F" -> "via the library").
 * @param {string} key
 * @returns {string}
 */
export const routePhrase = (key) => TEMPLATE_PHRASE[/** @type {keyof typeof TEMPLATE_PHRASE} */ (String(key).replace(/^retrieval:/, '').split(':')[0])] ?? 'that route';
