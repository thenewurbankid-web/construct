// The JavaScript-library lexicon: one sentence type per standard-library or
// Web API call, composed from grammar primitives (grammar.mjs) so every
// sentence is grammatical by construction — a verb conjugates itself, a
// predicate negates itself, an optional group drops cleanly.
//
// This is "our" domain. A project's own functions form the user domain
// (user-lexicon.mjs); prose.mjs consults ours first, then theirs.
//
//   action(call, verb, ...parts)            "sets the browser-storage key 'k' to `v`"
//   value(call, ...parts)                   "the keys of `config`"
//   predicate(call, subject, verb, ...parts) "`items` includes `x`" / "does not include"
//
// call: 'JSON.parse' covers that path (also reached through a longer one,
// `window.JSON.parse`; 'isNaN' covers `Number.isNaN`); '.map' covers that
// method on any receiver. Exact paths outrank methods.
// parts: plain strings are fixed words; arg(i) the described i-th argument;
// bare(i) the i-th argument as itself when it's a literal (500, 'open');
// args() every argument; rest() every argument after the first; target()
// the receiver; opt(...) a group dropped when it can't be filled.
import { action, value, predicate, verb, BE, HAVE, arg, bare, args, rest, target, opt } from './grammar.mjs';

const set = verb('set');
const read = verb('read');
const remove = verb('remove');
const clear = verb('clear');
const log = verb('log');
const stop = verb('stop');
const add = verb('add');

/** Every sentence type in our domain, in lookup order. */
export const JS_LEXICON = Object.freeze([
  // ---- Web Storage ---------------------------------------------------------
  action('localStorage.setItem', set, 'the browser-storage key', bare(0), 'to', arg(1)),
  action('localStorage.getItem', read, 'the browser-storage key', bare(0)),
  action('localStorage.removeItem', remove, 'the browser-storage key', bare(0)),
  action('localStorage.clear', clear, 'all browser storage'),
  action('sessionStorage.setItem', set, 'the session-storage key', bare(0), 'to', arg(1)),
  action('sessionStorage.getItem', read, 'the session-storage key', bare(0)),
  action('sessionStorage.removeItem', remove, 'the session-storage key', bare(0)),
  action('sessionStorage.clear', clear, 'all session storage'),

  // ---- Network -------------------------------------------------------------
  action('fetch', verb('fetch'), arg(0), opt('with', arg(1))),
  value('.json', 'the JSON body of', target()),

  // ---- Console -------------------------------------------------------------
  action('console.log', log, args()),
  action('console.info', log, args()),
  action('console.debug', log, args(), 'for debugging'),
  action('console.warn', log, 'the warning', args()),
  action('console.error', log, 'the error', args()),

  // ---- JSON ----------------------------------------------------------------
  value('JSON.parse', 'the value parsed from the JSON text', arg(0)),
  value('JSON.stringify', 'the JSON text of', arg(0)),

  // ---- Object --------------------------------------------------------------
  value('Object.keys', 'the keys of', arg(0)),
  value('Object.values', 'the values of', arg(0)),
  value('Object.entries', 'the key-value pairs of', arg(0)),
  value('Object.fromEntries', 'an object built from the key-value pairs', arg(0)),
  action('Object.assign', verb('copy'), 'everything from', rest(), 'into', arg(0)),
  value('Object.freeze', arg(0), ', frozen against changes'),
  predicate('Object.hasOwn', arg(0), HAVE, 'its own property', bare(1)),
  value('structuredClone', 'a deep copy of', arg(0)),

  // ---- Type conversion and checks -----------------------------------------
  value('Number', 'the number value of', arg(0)),
  value('String', 'the text form of', arg(0)),
  predicate('Boolean', arg(0), BE, 'truthy'),
  value('parseInt', 'the whole number read from', arg(0)),
  value('parseFloat', 'the number read from', arg(0)),
  predicate('isNaN', arg(0), BE, 'NaN'),
  predicate('Number.isInteger', arg(0), BE, 'a whole number'),
  predicate('Number.isFinite', arg(0), BE, 'a finite number'),
  predicate('Array.isArray', arg(0), BE, 'a list'),
  value('.toString', 'the text form of', target()),
  value('.toFixed', target(), 'rounded to', bare(0), 'decimal places'),

  // ---- Math ----------------------------------------------------------------
  value('Math.max', 'the largest of', args()),
  value('Math.min', 'the smallest of', args()),
  value('Math.round', 'the nearest whole number to', arg(0)),
  value('Math.floor', 'the whole number at or below', arg(0)),
  value('Math.ceil', 'the whole number at or above', arg(0)),
  value('Math.trunc', 'the whole-number part of', arg(0)),
  value('Math.abs', 'the absolute value of', arg(0)),
  value('Math.random', 'a random number between 0 and 1'),

  // ---- Arrays --------------------------------------------------------------
  value('Array.from', 'a list made from', arg(0), opt(', each item transformed by', arg(1))),
  value('Array.of', 'a list of', args()),
  value('.map', 'each item of', target(), 'transformed by', arg(0)),
  value('.flatMap', 'each item of', target(), 'transformed by', arg(0), ', flattened into one list'),
  value('.filter', 'the items of', target(), 'kept by', arg(0)),
  value('.find', 'the first item of', target(), 'that passes', arg(0)),
  value('.findIndex', 'the position of the first item of', target(), 'that passes', arg(0)),
  value('.some', 'whether any item of', target(), 'passes', arg(0)),
  value('.every', 'whether every item of', target(), 'passes', arg(0)),
  value('.reduce', 'the single value', arg(0), 'builds from', target(), opt(', starting from', arg(1))),
  action('.forEach', verb('run'), arg(0), 'for each item of', target()),
  predicate('.includes', target(), verb('include'), arg(0)),
  value('.indexOf', 'the position of', arg(0), 'in', target()),
  value('.join', 'the items of', target(), 'joined into text', opt('with', bare(0), 'between them')),
  value('.concat', target(), 'followed by', args()),
  value('.slice', 'part of', target(), opt('from position', bare(0)), opt('up to position', bare(1))),
  value('.flat', 'the flattened form of', target()),
  action('.push', add, args(), 'to the end of', target()),
  action('.sort', verb('sort'), target(), 'in place', opt('using', arg(0))),
  action('.reverse', verb('reverse'), target(), 'in place'),

  // ---- Strings -------------------------------------------------------------
  value('.trim', 'the trimmed text of', target()),
  value('.toLowerCase', 'the lowercase form of', target()),
  value('.toUpperCase', 'the uppercase form of', target()),
  value('.split', 'the pieces of', target(), 'split at every', bare(0)),
  predicate('.startsWith', target(), verb('start'), 'with', bare(0)),
  predicate('.endsWith', target(), verb('end'), 'with', bare(0)),
  value('.replace', target(), 'with', bare(0), 'replaced by', bare(1)),
  value('.replaceAll', target(), 'with every', bare(0), 'replaced by', bare(1)),
  predicate('.matches', target(), verb('match'), arg(0)),
  predicate('.test', arg(0), verb('match'), target()),
  value('encodeURIComponent', 'the URL-safe form of', arg(0)),
  value('decodeURIComponent', 'the URL-decoded form of', arg(0)),

  // ---- Map, Set, URLSearchParams, Headers, FormData ------------------------
  value('.get', 'the entry for', bare(0), 'in', target()),
  action('.set', set, 'the entry for', bare(0), 'in', target(), 'to', arg(1)),
  predicate('.has', target(), HAVE, 'an entry for', bare(0)),
  action('.add', add, arg(0), 'to', target()),
  action('.delete', remove, 'the entry for', bare(0), 'from', target()),
  action('.clear', verb('empty'), target()),

  // ---- Promises ------------------------------------------------------------
  value('Promise.all', 'the results of', arg(0), ', once all have succeeded'),
  value('Promise.allSettled', 'the outcomes of', arg(0), ', once all have settled'),
  value('Promise.race', 'the first of', arg(0), 'to settle'),
  value('Promise.any', 'the first of', arg(0), 'to succeed'),
  value('Promise.resolve', 'a promise already resolved', opt('with', arg(0))),
  value('Promise.reject', 'a promise already rejected', opt('with', arg(0))),

  // ---- Timers and scheduling ----------------------------------------------
  action('setTimeout', verb('schedule'), arg(0), opt('in', bare(1), 'milliseconds')),
  action('setInterval', verb('repeat'), arg(0), opt('every', bare(1), 'milliseconds')),
  action('clearTimeout', verb('cancel'), 'the scheduled timer', arg(0)),
  action('clearInterval', stop, 'the repeating timer', arg(0)),
  action('requestAnimationFrame', verb('schedule'), arg(0), 'before the next repaint'),
  action('queueMicrotask', verb('queue'), arg(0), 'right after the current task'),

  // ---- Dates and ids -------------------------------------------------------
  value('Date.now', 'the current time in milliseconds'),
  value('.toISOString', 'the ISO date text of', target()),
  value('.getTime', 'the timestamp of', target(), 'in milliseconds'),
  value('crypto.randomUUID', 'a new random unique id'),

  // ---- DOM -----------------------------------------------------------------
  value('document.querySelector', 'the first element matching', bare(0)),
  value('document.querySelectorAll', 'every element matching', bare(0)),
  value('document.getElementById', 'the element with id', bare(0)),
  value('document.createElement', 'a new', bare(0), 'element'),
  value('.closest', 'the nearest element around', target(), 'matching', bare(0)),
  value('.getAttribute', 'the', bare(0), 'attribute of', target()),
  action('.setAttribute', set, 'the', bare(0), 'attribute of', target(), 'to', arg(1)),
  action('.appendChild', add, arg(0), 'inside', target()),
  action('.focus', verb('move'), 'focus to', target()),
  action('classList.add', add, 'the CSS class', bare(0), 'to', target()),
  action('classList.remove', remove, 'the CSS class', bare(0), 'from', target()),
  action('classList.toggle', verb('toggle'), 'the CSS class', bare(0), 'on', target()),

  // ---- Events --------------------------------------------------------------
  action('.addEventListener', verb('listen'), 'on', target(), 'for', bare(0), 'events, handling them with', arg(1)),
  action('.removeEventListener', stop, target(), 'handling', bare(0), 'events with', arg(1)),
  action('.dispatchEvent', verb('fire'), 'the event', arg(0), 'on', target()),
  action('.preventDefault', stop, "the browser's default handling of", target()),
  action('.stopPropagation', stop, target(), 'from bubbling up to outer elements'),

  // ---- Promises: chaining ---------------------------------------------------
  value('.then', target(), ', then', arg(0), opt(', or on failure', arg(1))),
  value('.catch', target(), ', handling a failure with', arg(0)),
  value('.finally', target(), ', then either way', arg(0)),

  // ---- Node: files ----------------------------------------------------------
  predicate('existsSync', arg(0), verb('exist')),
  value('readFileSync', 'the contents of the file', arg(0), opt('read as', bare(1))),
  action('writeFileSync', verb('write'), arg(1), 'to the file', arg(0), opt('as', bare(2))),
  action('appendFileSync', verb('append'), arg(1), 'to the file', arg(0), opt('as', bare(2))),
  action('mkdirSync', verb('create'), 'the folder', arg(0), opt('with', arg(1))),
  value('readdirSync', 'the entries of the folder', arg(0), opt('with', arg(1))),
  value('statSync', 'the file details of', arg(0)),
  value('lstatSync', 'the link details of', arg(0)),
  action('rmSync', remove, arg(0), opt('with', arg(1))),
  action('unlinkSync', remove, 'the file', arg(0)),
  action('renameSync', verb('rename'), arg(0), 'to', arg(1)),
  action('copyFileSync', verb('copy'), 'the file', arg(0), 'to', arg(1)),
  value('realpathSync', 'the real path of', arg(0)),
  value('mkdtempSync', 'a new temporary folder starting with', arg(0)),
  predicate('.isFile', target(), BE, 'a file'),
  predicate('.isDirectory', target(), BE, 'a folder'),

  // ---- Node: paths ----------------------------------------------------------
  value('path.join', 'the path', args(), 'joined'),
  value('path.resolve', 'the absolute path of', args()),
  value('path.relative', 'the path to', arg(1), 'from', arg(0)),
  value('dirname', 'the folder of', arg(0)),
  value('basename', 'the file name of', arg(0), opt('without', bare(1))),
  value('extname', 'the extension of', arg(0)),
  predicate('isAbsolute', arg(0), BE, 'an absolute path'),
  value('fileURLToPath', 'the file path of the URL', arg(0)),

  // ---- Node: process --------------------------------------------------------
  action('process.exit', verb('exit'), 'the program', opt('with code', bare(0))),
  value('process.cwd', 'the current working folder'),
  action('spawnSync', verb('run'), 'the command', bare(0), opt('with', arg(1)), opt('and', arg(2))),
  action('execSync', verb('run'), 'the shell command', arg(0), opt('with', arg(1))),

  // ---- Browser navigation and dialogs -------------------------------------
  action('history.pushState', add, 'a browser-history entry holding', arg(0), opt('titled', bare(1)), opt('for', bare(2))),
  action('history.back', verb('go'), 'back one page in browser history'),
  action('location.assign', verb('send'), 'the browser to', arg(0)),
  action('alert', verb('show'), 'the alert', arg(0)),
  predicate('confirm', 'the user', verb('confirm'), arg(0)),
]);
