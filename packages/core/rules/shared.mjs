// Tiny helpers shared by more than one packages/core/rules/*.mjs file. Kept separate from
// architecture-enforcer.mjs deliberately -- #545's migrated rule files must not import from the
// old hard-coded-branch file they are replacing, so each stays independently readable and the
// two implementations can be compared byte-for-byte without a hidden shared dependency.

/** Whether `specifier` refers to the "react" package or a "react/" subpath (mirrors
 * architecture-enforcer.mjs's own isReactSpecifier -- kept as a second, independent copy on
 * purpose, see the module doc comment above).
 * @param {string} specifier - an import specifier.
 * @returns {boolean} true when `specifier` is `"react"` or starts with `"react/"`.
 */
export function isReactSpecifier(specifier) {
  return specifier === 'react' || /(^|\/)react\//.test(specifier);
}
