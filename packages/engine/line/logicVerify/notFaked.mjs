// Line logic verification, spec E (step 5): the one error a layout fake throws when code reads something it does not
// back, so a run fails loudly at the exact member instead of computing with `undefined`.

/** A layout fake was read (or set) at a member it does not back; `member` names it as `<Type>.<member>`. */
export class NotFakedError extends Error {
  /**
   * @param {string} type The fake's type, e.g. `Window`.
   * @param {string} member The member the code read, e.g. `alert`.
   * @param {boolean} declared Whether lib.dom.d.ts declares the member on that type.
   * @param {string} [hint] What the fakes do back.
   */
  constructor(type, member, declared, hint) {
    const why = declared ? `lib.dom.d.ts declares it on ${type}, but the layout fakes do not back it` : `lib.dom.d.ts declares no ${member} on ${type}`;
    super(`${type}.${member} is not faked: ${why}${hint ? `; ${hint}` : ''}.`);
    this.name = 'NotFakedError';
    /** `<Type>.<member>`, for a verdict's reason. */
    this.member = `${type}.${member}`;
  }
}
