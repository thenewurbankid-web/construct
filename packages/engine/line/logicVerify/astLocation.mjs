// Line logic verification: where two versions of one function first differ, as a contract VerdictLocation (an astPath
// from the function's name down one typescript-estree node per segment, plus file and line). The proof and sample
// layers (z3Prove.mjs, fastCheckLayer.mjs) find THAT a unit changed; this names the differing expression.
// Positional params are compared by position, so a renamed param is not reported as the difference.
/** @typedef {import('./contract.mjs').VerdictLocation} VerdictLocation */

/** Keys that are positions, back-links or types: never a behaviour difference. */
const SKIP = new Set(['range', 'loc', 'parent', 'typeAnnotation', 'returnType', 'typeParameters', 'typeArguments', 'comments', 'tokens', 'raw']);
const isNode = (v) => v !== null && typeof v === 'object' && typeof v.type === 'string';

/**
 * The first place (in source order) where `before` and `after` differ, or null when they are the same tree.
 * @param {any} before A function node (typescript-estree).
 * @param {any} after The same function in the after code.
 * @param {{fn: string, file: string}} where `fn` starts the astPath; `file` is the after file (app-relative).
 * @returns {VerdictLocation|null}
 */
export function diffLocation(before, after, { fn, file }) {
  const rename = new Map();
  (before.params ?? []).forEach((p, i) => { const q = after.params?.[i]; if (p.type === 'Identifier' && q?.type === 'Identifier') rename.set(p.name, q.name); });
  const at = (node, path, side) => ({ astPath: path, file, line: node.loc.start.line, ...(side === 'before' ? { side } : {}) });

  /** @returns {VerdictLocation|null} */
  const walk = (b, a, path) => {
    if (b.type !== a.type) return at(a, path, 'after');
    for (const key of Object.keys(a)) {
      if (SKIP.has(key) || key === 'type') continue;
      const bv = b[key];
      const av = a[key];
      const seg = `${path}/${a.type}.${key}`;
      if (Array.isArray(av) || Array.isArray(bv)) {
        const bl = bv ?? [];
        const al = av ?? [];
        for (let i = 0; i < Math.max(bl.length, al.length); i++) {
          if (i >= al.length) return at(bl[i], `${seg}[${i}]`, 'before');
          if (i >= bl.length) return at(al[i], `${seg}[${i}]`, 'after');
          const hit = isNode(al[i]) && isNode(bl[i]) ? walk(bl[i], al[i], `${seg}[${i}]`) : (al[i] === bl[i] ? null : at(a, seg, 'after'));
          if (hit) return hit;
        }
      } else if (isNode(av) || isNode(bv)) {
        if (!isNode(av) || !isNode(bv)) return at(isNode(av) ? av : a, seg, 'after');
        const hit = walk(bv, av, seg);
        if (hit) return hit;
      } else if (key === 'name' && a.type === 'Identifier') {
        if ((rename.get(bv) ?? bv) !== av) return at(a, seg, 'after');
      } else if (key === 'value' && a.type === 'Literal') {
        if (!Object.is(bv, av) && !(bv instanceof RegExp && String(bv) === String(av))) return at(a, seg, 'after');
      } else if (bv !== av && (typeof av !== 'object' || typeof bv !== 'object')) {
        return at(a, seg, 'after');
      }
    }
    return null;
  };
  return walk(before, after, fn);
}
