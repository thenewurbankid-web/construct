// line-expressions: which file line.extractExpression writes (the pure part of expressions.mjs). Pure (no Node imports),
// so the plan conditions (conditions.mjs) load in Cockpit's browser mock too (the Import agent's mock bundles them).

/**
 * The root-relative file of a new expression next to `file`: its library's or its feature's expressions/ folder.
 * @param {{library: string, features: string}} layout
 * @param {string} file Root-relative page or component.
 * @param {string} name The expression's name.
 * @returns {string|null} null when the file is in neither the library nor a feature.
 */
export function expressionTarget(layout, file, name) {
  const rel = String(file ?? '');
  const under = (dir) => rel.startsWith(`${dir}/`);
  if (under(layout.library)) return `${layout.library}/expressions/${name}.tsx`;
  if (under(layout.features)) {
    const segs = rel.slice(layout.features.length + 1).split('/');
    if (segs.length >= 2 && segs[0]) return `${layout.features}/${segs[0]}/expressions/${name}.tsx`;
  }
  return null;
}
