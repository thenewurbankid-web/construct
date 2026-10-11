// The contract mock's fragment reader (mock.mjs): a small regex reader for the mock project's own files, with no
// parser, so it also runs in the browser (Line mock mode). It finds `name={...}` attributes without nested braces,
// the shape the mock writes; the real reader is fragments.mjs (typescript-estree).

/** A short, stable, non-cryptographic hash (FNV-1a), enough for the mock's stale check. @param {string} s */
export function mockHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `mock-${h.toString(16)}`;
}

/** @param {string} name e.g. "onClick" @param {string} who */
function handlerLabel(name, who) {
  const event = name.slice(2).toLowerCase();
  return event === 'click' ? `What happens when ${who} is clicked` : `What happens when ${who} asks for ${event}`;
}

/** @param {string} source @param {string} file @returns {import('./contract.mjs').CodeFragment[]} */
export function mockFragmentsOf(source, file) {
  const contentHash = mockHash(source);
  /** @type {import('./contract.mjs').CodeFragment[]} */
  const out = [];
  for (const m of source.matchAll(/\s([A-Za-z][\w-]*)=\{([^{}]*)\}/g)) {
    const [, name, code] = m;
    if (!code.trim() || /^(true|false|-?\d+(\.\d+)?)$/.test(code.trim())) continue;
    const start = /** @type {number} */ (m.index) + m[0].indexOf('{') + 1;
    const before = source.slice(0, start);
    const nodeId = `n${(before.match(/<[A-Za-z]/g) || []).length - 1}`;
    const tag = (before.match(/<([A-Za-z][\w.]*)[^<]*$/) || [])[1] || 'this part';
    const handler = /^on[A-Z]/.test(name);
    const style = name === 'style' || name === 'className';
    /** @type {import('./contract.mjs').FragmentKind} */
    const kind = handler ? 'handler' : style ? 'style' : 'prop-expression';
    const label = handler ? handlerLabel(name, tag) : style ? `How ${tag} looks (${name})` : `The value of ${name} on ${tag}`;
    out.push({ id: `${kind}:${nodeId}:${name}`, file, kind, label, code, range: { start, end: start + code.length }, contentHash, nodeId });
  }
  return out;
}
