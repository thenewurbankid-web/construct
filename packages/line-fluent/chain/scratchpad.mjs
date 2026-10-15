// Scratchpads for the 7b chain (owner, 2026-10-15: "task specific model chain with scratch pads and a shared scratchpad
// ... auto compact"). Each role of the chain keeps its own pad (what it chose and how that went), and every role reads
// one shared pad (answers that passed and refusals). A pad is a short text a prompt can carry, so it compacts itself:
//
//   notes        newest last; each {tag, text, outcome: 'pass' | 'refused' | null}
//   compaction   once the pad's text passes `limit` characters, the older notes fold into one tally line per tag
//                ("shape list(·).VERB().with(·): 3 passed, 2 refused") and up to `pinned` passing notes are kept as
//                examples; the newest `keep` notes stay as written. No model is asked: the same notes compact the same.
//
// Pads are plain data (toJSON / fromJSON), so a run can save and resume them.

export class Scratchpad {
  /**
   * @param {string} name
   * @param {{limit?: number, keep?: number, pinned?: number}} [options]
   */
  constructor(name, { limit = 1200, keep = 6, pinned = 3 } = {}) {
    Object.assign(this, { name, limit, keep, pinned });
    this.notes = [];
    this.examples = [];
    this.tally = new Map();
    this.compactions = 0;
  }

  /** Adds one note and compacts when the pad has grown past its limit. */
  add(tag, text, outcome = null) {
    this.notes.push({ tag: String(tag), text: String(text).replace(/\s+/g, ' ').trim(), outcome });
    if (this.text().length > this.limit) this.compact();
    return this;
  }

  /** Folds every note but the newest `keep` into the tally and the pinned examples. */
  compact() {
    const old = this.notes.splice(0, Math.max(0, this.notes.length - this.keep));
    for (const n of old) {
      const t = this.tally.get(n.tag) ?? { pass: 0, refused: 0, other: 0 };
      t[n.outcome === 'pass' ? 'pass' : n.outcome === 'refused' ? 'refused' : 'other'] += 1;
      this.tally.set(n.tag, t);
      if (n.outcome === 'pass' && !this.examples.includes(n.text)) this.examples.push(n.text);
    }
    this.examples = this.examples.slice(-this.pinned);
    // A tally that still does not fit keeps its busiest tags.
    while (this.text().length > this.limit && this.tally.size > 1) {
      const quiet = [...this.tally].sort(([, a], [, b]) => total(a) - total(b))[0][0];
      this.tally.delete(quiet);
    }
    this.compactions += 1;
    return this;
  }

  /** The pad as prompt text: tallies, pinned examples, then the newest notes. Empty when nothing was noted. */
  text() {
    const lines = [];
    for (const [tag, t] of this.tally) lines.push(`- ${tag}: ${[t.pass && `${t.pass} passed`, t.refused && `${t.refused} refused`, t.other && `${t.other} noted`].filter(Boolean).join(', ')}`);
    for (const e of this.examples) lines.push(`- passed: ${e}`);
    for (const n of this.notes) lines.push(`- ${n.outcome ? `${n.outcome}: ` : ''}${n.text}`);
    return lines.length ? `${this.name}:\n${lines.join('\n')}` : '';
  }

  toJSON() {
    return { name: this.name, limit: this.limit, keep: this.keep, pinned: this.pinned, notes: this.notes, examples: this.examples, tally: [...this.tally], compactions: this.compactions };
  }

  static fromJSON(data) {
    const pad = new Scratchpad(data.name, data);
    Object.assign(pad, { notes: data.notes ?? [], examples: data.examples ?? [], tally: new Map(data.tally ?? []), compactions: data.compactions ?? 0 });
    return pad;
  }
}

const total = (t) => t.pass + t.refused + t.other;

/**
 * One set of pads per section (entries of one section share what they learn): the shared pad and one per role.
 * @param {string[]} roles
 */
export function padBoard(roles, options = {}) {
  const sections = new Map();
  return {
    of(section) {
      if (!sections.has(section)) {
        sections.set(section, {
          shared: new Scratchpad(`Shared notes for ${section}`, { limit: 1600, ...options }),
          ...Object.fromEntries(roles.map((r) => [r, new Scratchpad(`Your notes as the ${r} step`, options)])),
        });
      }
      return sections.get(section);
    },
    toJSON: () => Object.fromEntries([...sections].map(([s, pads]) => [s, Object.fromEntries(Object.entries(pads).map(([k, p]) => [k, p.toJSON()]))])),
  };
}
