# Carry-over 2026-10-14: the full JavaScript reference as Smith's input

Owner-approved plan: https://claude.ai/artifact/BmuG6VUphzCC3qe8dygKM9 (Part 3). Rules: smith-functional/ENGLISH-RULES.md.
Nothing here is committed.

## Goal
Generate one big JS input from the full JavaScript reference (every built-in up to ES2025, every syntax form, the Web
APIs Node 24 provides), test it with Node's own output as the expected answer, then give it to Smith (toAtoms) and
measure what converts. Owner wants to **see the JS input first**, before any conversion.

## What exists
- `list.mjs` -> `reference.json`: 2,378 entries (es 1,711 · web 511 · syntax 156). Reads ES2025 lib files from
  smith-functional's TypeScript 7 install (`--lib` or `TS_LIB_DIR` overrides) and lib.dom from this repo's TS 5.9.
- `syntax.json`: 156 syntax entries, each with the Babel node (and fields) that proves it is present.
- `build.mjs` -> `input/ref-*.mjs` (151 files, one function per entry) + `map.json` (entry -> file/function, plus
  async/nondeterministic flags). Receivers per section, value rules by param name/type, `OVERRIDES` for SubtleCrypto,
  BYOB streams, a closed writer.
- `run.mjs`: runs every function, describes results as plain data; `--update` writes expected.json, `--errors`,
  `--list`, `--dir <converted copy>`. Last run: 2,222 run, 2,168 returned, 54 threw.

## Fixed since the first carry-over
1. Case-insensitive file names: lower-case sections now get `-global` (`ref-crypto-global.mjs`); 0 missing.
2. `Intl.DisplayNames #2` uses the INTL receiver with `{ type: 'region' }`.
Last run: 2,222 run, 2,160 return, 45 throw, 17 not in Node.

## Reference app
`site.mjs` + `site.template.html` -> `site/index.html`: every entry with its example and Node's output, search,
layer and result filters. Published: https://claude.ai/artifact/UNjWroCdmti4ftqbYMo23X (republish the same file
after `node site.mjs`). Syntax entries show their Babel node until `input/syntax.mjs` exists.

## The 54 throws that are genuine (keep as expected outputs)
Illegal constructors (Crypto, CryptoKey, SubtleCrypto, Navigator, Performance*, stream controllers…), strict-mode
`caller`/`arguments`/`callee`, `Generator#throw`/`Promise.reject` passing 9 through, `throwIfAborted`, Navigator
methods and `CustomEvent.initCustomEvent` missing in Node, `WebSocket.send` before connect, and all 20
`PerformanceResourceTiming` members (Node 24 records no resource timings; checked).

## State on 2026-10-15
- `input/syntax.mjs` (156 hand-written syntax functions), `syntax-helper.mjs`, `syntax-data.json`, `sloppy.cjs`
  (`with`). All 2,378 entries run in Node; 0 missing; 0 syntax failures.
- Atlas v2 imports the real modules from `input/` (published as artifact files; `sloppy.cjs` as `input/sloppy.js`),
  shows each function's own source, and has Run / Run all comparing the browser with Node.
  **Not yet verified in a browser.** A local copy for checking is staged in the scratchpad (`atlas-serve/`).
- Done since: `expected.json` (2,316 return, 62 throw) and `reference.test.mjs`: 3 tests pass (outcomes match,
  every entry has a function, Babel finds every syntax node); the run exits cleanly (examples that open a channel or
  timer close it). Atlas v3 published with "Run all 2,378 entries"; checked in a local browser: 2,243 of 2,378 match
  Node, the 135 others are real browser-vs-Node differences (33 are SharedArrayBuffer, off without cross-origin
  isolation).

## Owner decisions 2026-10-15 (the conversion stage)
1. **Target:** build the Atomic English rules into Smith first (smith-functional/ENGLISH-RULES.md, build order
   steps 1-4), so every conversion can be run and checked. Then convert.
2. **Fine-tuning:** keep every conversion and correction as training data; decide on fine-tuning the 1.5B model
   after measuring. The earlier "No LoRA: Line-1 is trained from scratch" decision stands until then.
3. **No atom fits:** the converter proposes new atoms; each needs the owner's approval before it joins Smith.
4. **Pipeline after that:** convert the full reference (Claude as the converter inside Smith's checked loop), review
   it and document it in a second Atlas-like artifact, then have the local 1.5B model convert through Smith, catch
   its mistakes against the reviewed conversions, and keep both as starter data for self-improvement.

## Next steps
1. Fix the two bugs, rebuild, re-run.
2. Hand-write `input/syntax.mjs` (one function per syntax.json entry; module-only forms at top level; `with` in
   `input/sloppy.cjs`).
3. `run.mjs --update` -> `expected.json`.
4. `reference.test.mjs`: every function matches expected.json; coverage: every reference.json key has a function in
   map.json, and a Babel walk finds every syntax.json node in syntax.mjs/sloppy.cjs.
5. **Show the owner the input** (a sample per layer + counts) before converting anything.
6. After approval: build the English rules into Smith (ENGLISH-RULES.md build order), then convert and measure.
