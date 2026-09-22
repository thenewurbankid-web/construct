Contributions are welcome. This page is the short version of how to work on Construct itself.

## Set up

```bash
git clone https://github.com/thenewurbankid-web/construct.git
cd construct
npm install
npm test
```

Install `ui/client`, `ui/server` and `ui/e2e` only if you work on the Cockpit. See [Testing](@developers/testing/) for all the test commands.

## What makes a good change

- **Prefer a deterministic block.** Before adding a capability, ask whether it adds a small, testable block, makes an existing one more atomic, or improves the concrete example one step hands to the next. Work that would make a model do what a block could do belongs in a block.
- **Reuse before writing.** Check [Building blocks](@developers/building-blocks/); parse TypeScript with `packages/ast`, write files through the transactional writer, call models only through `src/llm.mjs`.
- **Keep model use opt-in and checked.** A model call must be explicitly requested, scoped to one file, and its output validated before it is written.
- **Prefer established open-source libraries** over hand-rolled code, and check the licence first: this project is MIT, so GPL or AGPL dependencies are not acceptable.
- **Test with real files.** Add or extend a suite in `test/` (see [Testing](@developers/testing/)).
- **Update the docs that describe the behaviour.** The pages here reuse `README.md` and `docs/`, so editing those updates this site.

## The Cockpit UI

The UI is organised in the same feature layers Construct enforces (`domain`, `service`, `workflow`, `hook`, `component`, `page`, `controller`). Run `construct validate --dir ui/client` to check it; a few known violations exist in the baseline, so make sure you do not add new ones. UI changes should come with a Playwright test in `ui/e2e/`.

## Sending a change

1. Branch from `main`.
2. Make a focused change with tests; run `npm test` in full.
3. Open a pull request describing what changed and how you verified it.
