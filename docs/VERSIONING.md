# Versioning and releases

One repo-wide version, [SemVer](https://semver.org), pre-1.0 for now. Releases are git tags `vX.Y.Z`, each with a
GitHub Release, a GitHub milestone of the same name, and an entry in `CHANGELOG.md`
([Keep a Changelog](https://keepachangelog.com) format).

## Roadmap

| Version | Content |
| --- | --- |
| v0.8.0 | Baseline: Plan -> Execute stack, PR review, QA tests and run-a-test, hosted Cockpit with GitHub login, workspace jail, docs site (needs #389 and #390 merged). |
| v0.9.0 | MVP: five-screen shell and profile menu (#367 slices 1-3 and 6), durable Notes, declutter quick wins, the "Notes" rename (#366), clone from GitHub (#330 slice A). |
| v0.10.0 | Rules and envelopes composer (#395) and the remaining #367 slices: preview-first Pages/Components, Generate control, Story. |
| v1.0.0 | When the CLI, plan, `architecture.yml` and process schemas are declared stable, the open-core split is decided and private-repo clone is decided. |

Milestones on GitHub carry the same names and descriptions. Standing tickets (#35, #38, #180, #182, #184, #224) and
issues blocked on the owner or post-MVP (#317, #319, #331) have no milestone. The project board has no Milestone
field (and its schema is not changed for this): filter by milestone on the issues page, or use `milestone:v0.9.0`
in a board filter.

## What gets a number

- One version for the whole repo. `package.json` at the root, `packages/cli/package.json`, `packages/core/package.json`,
  `packages/ast/package.json`, `ui/client/package.json` and `ui/server/package.json` move in lockstep with it.
  (`ui/e2e`, `packages/tools/*` and `packages/engine` — plain source with no `package.json` of its own — are private/internal and are not versioned.)
- Data schemas keep their own `vN` (for example a plan or process schema `v2`); see "Schema policy" below.
- While below 1.0: a breaking change to the CLI, a data schema or `architecture.yml` bumps the MINOR; a feature bumps
  the MINOR; a fix bumps the PATCH. From 1.0: breaking = MAJOR, feature = MINOR, fix = PATCH.
- Breaking changes are called out under `### Changed` or `### Removed` in the changelog with a `BREAKING:` prefix.

## Schema policy (plan, process, envelope)

Stored records (`schemas/plan.v1.json`, `process.v1.json`, `envelope.v1.json`) follow one rule, so an older or newer
server never has to declare a record unreadable because of an added field.

- **Additive data goes in `ext`.** Each record has a reserved top-level `ext` object: free-form (any JSON object),
  ignored by every validator, and preserved unchanged on read/write. Adding data there does not bump the schema
  version and needs no migration.
- **Unknown top-level fields other than `ext` stay rejected** (`PLAN_UNKNOWN_FIELD`, `PROCESS_UNKNOWN_FIELD`), so a
  typo is caught. `required` stays strict. A non-object `ext` is a field-type error.
- **A breaking change creates `vN+1`.** Add `schemas/<name>.v(N+1).json`, bump the version constant, and extend
  `migratePlan()` / `migrateProcess()` (identity for v1) so a v(N) record is upgraded to v(N+1). The store read path
  (`processStore.readFile`) calls the migrate step before validating, and the repo version is bumped per the rules
  below.
- **Fixtures per version.** `test/fixtures/plan/` and `test/fixtures/process/` hold one record per schema version
  (`v1.json` now, plus `v1-ext.json`); `test/schemaMigration.test.mjs` asserts every fixture migrates, validates and
  round-trips, so adding a version means adding its fixture.

## Versioned documentation

The documentation website is versioned together with the app.

- Every release `vX.Y.Z` publishes its own docs at `/<X.Y>/` (for example `/0.8/`), built from that tag. Patch
  releases overwrite the same `/<X.Y>/` path.
- The site root is `latest` (the newest release). `/next/` tracks `main` (unreleased). Older versions are kept.
- The site shows a version switcher, and non-latest pages show a banner: "You are reading docs for v0.8 - see latest".
- GitHub Pages replaces the whole site on each deploy, so `.github/workflows/pages.yml` builds every tag plus `main`
  into one artifact. `site/build.mjs` takes `--base-path` and `--version`. (Implementation: issue #397.)
- With no release tag yet, `main` is built as both the site root and `/next/`, shown as "next", with no switcher.

Commands (all offline; run from the repo root after `npm ci`):

```
# Every version into one directory: / = newest tag, /X.Y/ per minor, /next/ = HEAD (what pages.yml runs)
node site/build-all.mjs --out site/dist [--repo owner/name] [--no-search] [--next-ref main]

# One version by hand (this is what build-all runs for each ref, using that ref's own site/build.mjs)
node site/build.mjs --out /tmp/docs-0.8 --base-path /construct/0.8/ --version 0.8 --versions-file versions.json
```

`versions.json` is `{"versions":[{"id":"0.8","label":"v0.8","base":"/construct/0.8/","latest":false}, ...]}`; the
list comes from `planBuilds()` in `packages/docs-site/lib/versions.mjs` (newest `vX.Y.Z` tag per minor, then `next`). Only refs
that contain #397 can be published, so the first release is the first version with docs. The switcher links to the
same page in each version (a page that does not exist there falls to the 404 page); the banner links to the latest
home. Tests: `node --test site/test/*.test.mjs`.
- Each example page has a "checked against" line that records a commit. The release procedure must re-verify each
  example and re-stamp that line to the release commit before tagging.
- Caveat: tutorials are currently rendered from published guide tickets at build time, so a rebuild of an old tag
  would pick up current ticket text. #397 should snapshot that content at release time.

## Cutting a release

1. Confirm every issue in the milestone is closed or moved to the next milestone, and `npm test` passes in full.
2. Re-verify the docs examples and re-stamp their "checked against" commit (see above).
3. Bump `version` in the four package.json files listed above to `X.Y.Z` (lockfiles follow via `npm install --package-lock-only`).
4. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`, add a fresh empty `## [Unreleased]`
   above it, and update the compare links at the bottom.
5. Commit as `release: vX.Y.Z` on a branch, open a PR, merge it.
6. Tag the merge commit and push the tag: `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`.
7. Create the GitHub Release from the tag, with the changelog section as notes:
   `gh release create vX.Y.Z --title vX.Y.Z --notes-file <the section>`. A pre-1.0 release is marked `--prerelease`
   until v1.0.0.
8. Close the milestone (`gh api -X PATCH repos/thenewurbankid-web/construct/milestones/<n> -f state=closed`) and
   confirm the docs deploy published `/<X.Y>/` and moved the site root.
9. Post the release link on the Notice Board (#224).

## Notes on the current state

The root, `packages/cli`, `packages/core` and `packages/ast` package.json files said `1.0.0` although the project is
pre-1.0; #525 reset them to the `0.8.0` baseline for real (`construct-architecture` was never published to npm at
`1.0.0`, so no dist-tag conflict). `packages/engine` has no `package.json` of its own (it is plain source, consumed
only via relative imports from `packages/core`/`packages/cli` — not an independently versioned package) and so is
not part of this or any future version bump unless it becomes one. `ui/client` and `ui/server` (currently `0.2.0`
and `0.1.0`) are intentionally left as-is by #525 — the Cockpit's own versioning is a separate, not-yet-cut decision
(see #480) — but "Cutting a release" step 3 above still lists them: resolve that when v0.8.0 is actually tagged.
`v0.8.0` is the first tag. It is cut on `work/2026-09-23` while `main` stays frozen at `stable-2026-09-23`; the Cockpit packages stay unversioned until #480 is decided.
