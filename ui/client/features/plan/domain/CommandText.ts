// Pure (DOMAIN-001): the exact command a step will run, as one line a person can read and copy. `argv` comes
// from the server's planToCommand() (an array; nothing is ever run through a shell). Quoting is for the eye.
const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

export const quoteWord = (w: string): string => (w === '' ? "''" : SAFE.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`);

export const commandLine = (argv: string[]): string => argv.map(quoteWord).join(' ');
