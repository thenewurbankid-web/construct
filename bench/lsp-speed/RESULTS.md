# Line LSP speed on real-size projects

This is a measurement only. No product code changed. The script is `bench/lsp-speed/measure.mjs` and the raw numbers are in `results.json`.

- **Run:** 2026-10-14, once, through `heavy.sh`.
- **Construct:** `83c20cd8` (private/line/lsp-into-line).
- **Machine:** Apple M5 Pro x18, 24 GB. The machine contract says 15 GB with no swap, and the numbers are judged against that.
- **Versions:** Node 24.19, TypeScript 5.9.3.
- **Smith:** the hardened one, raw TS/TSX input (`LSP_SMITH_RAW=1`), atomic-codemod `cbc25671`.

Every "cold" number comes from a fresh node process. Projects were copied or shallow-cloned into a new `/tmp/construct-lsp-speed-<pid>/`, which was deleted afterwards. The clones were parsed only: no npm, no scripts, no `node_modules`.

| project | source | code files | functions (Smith-indexed) |
|---|---|--:|--:|
| line-primitives | `packages/line-primitives`. `packages/` has no `tsconfig.json`, so this is the largest package that has one. `packages/` as a whole is 869 code files and 5327 top-level functions. | 94 | 200 |
| lending-starter | `bench/lending/starter`, a Line project with one feature (`browse`, no code yet) | 17 | 13 |
| vercel-commerce | github.com/vercel/commerce `3761e52e`, MIT | 66 | 105 |
| excalidraw | github.com/excalidraw/excalidraw `541653c7`, MIT | 693 | 2047 |

## 1. Full build (shipped `createLineLsp`)

`createLineLsp` does not build the TS program. The first TS call pays for it, and that cost is shown as "+TS on first call". The split into layers comes from a separate fresh process that ran the same layer functions one after another.

| project | files | functions | TS service | Smith index | rules index | createLineLsp build | RSS after build / peak |
|---|--:|--:|--:|--:|--:|--:|--:|
| line-primitives | 94 | 200 | 175 ms | 2883 ms | **13760 ms** | 17228 ms (+128 ms TS on first call) | 669 / 687 MB |
| lending-starter | 17 | 13 | 149 ms | 297 ms | 565 ms | 846 ms (+107 ms TS on first call) | 394 / 471 MB |
| vercel-commerce | 66 | 105 | 151 ms | 1572 ms | 139 ms | 1773 ms (+112 ms TS on first call) | 339 / 467 MB |
| excalidraw | 693 | 2047 | 547 ms | **19853 ms** | 69 ms | 19326 ms (+454 ms TS on first call) | 563 / 865 MB |

## 2. Calls (ms): cold first call, then warm median / p95 of 20

"full" is the product API (`lsp.diagnostics`, `completionsAt`, `quickInfo`, `definition`, `fixes`, `nextSteps`).

The "raw" columns make the same TypeScript calls straight on the language service. That is the only way to call a scope-only service, so **scoped raw warm** compared with **full raw warm** is the like-for-like comparison.

Raw `fixes` is a single round. The product `fixes` runs up to 8.

| project | call | full cold | full warm | scoped raw cold | scoped raw warm | full raw warm |
|---|---|--:|--:|--:|--:|--:|
| line-primitives | diagnostics | 43.7 | 28 / 36.6 | 18.1 | 0.3 / 5.1 | 0 / 0 |
| line-primitives | completionsAt | 31.4 | 5.4 / 17.1 | 21.6 | 3.2 / 5.7 | 3.7 / 6.2 |
| line-primitives | quickInfo | 9.8 | 1.2 / 7.6 | 2.3 | 0.2 / 0.3 | 0 / 0.1 |
| line-primitives | definition | 1.2 | 0.6 / 0.7 | 0.7 | 0.2 / 0.2 | 0 / 0.1 |
| line-primitives | fixes | 17.3 | 1.1 / 9.6 | 3.6 | 1.7 / 2.1 | 0.4 / 0.5 |
| line-primitives | nextSteps | 0.2 | 0 / 0 | n/a | n/a | n/a |
| lending-starter | diagnostics | 22.6 | 12 / 22 | 9.9 | 0.3 / 0.7 | 0 / 0 |
| lending-starter | completionsAt | 36.4 | 4.3 / 22.3 | 28.1 | 3 / 5.5 | 2.6 / 3.7 |
| lending-starter | quickInfo | 10.2 | 0.4 / 8.9 | 2.9 | 0.2 / 0.3 | 0 / 0.1 |
| lending-starter | definition | 1.1 | 0.4 / 0.6 | 1.2 | 0.2 / 0.2 | 0 / 0.1 |
| lending-starter | fixes | 8.9 | 0.6 / 6.1 | 3.6 | 1.6 / 1.9 | 0.3 / 0.5 |
| lending-starter | nextSteps | 1 | 0 / 0 | n/a | n/a | n/a |
| vercel-commerce | diagnostics | 88.2 | 59.4 / 76.1 | 23.5 | 0.3 / 0.4 | 0 / 0.1 |
| vercel-commerce | completionsAt | 26.9 | 4.2 / 14.9 | 18.5 | 2.6 / 5.1 | 2.4 / 3.9 |
| vercel-commerce | quickInfo | 12.1 | 0.9 / 8.5 | 4 | 0.2 / 0.9 | 0 / 0.2 |
| vercel-commerce | definition | 1.5 | 0.8 / 0.9 | 1.1 | 0.2 / 0.4 | 0 / 0.1 |
| vercel-commerce | fixes | 12.5 | 1.3 / 12.7 | 2.4 | 1 / 1.3 | 0.2 / 0.4 |
| vercel-commerce | nextSteps | 0.1 | 0 / 0 | n/a | n/a | n/a |
| excalidraw | diagnostics | **312.1** | 30.6 / **99.5** | 79.6 | 1.9 / 3.5 | 0.1 / 0.2 |
| excalidraw | completionsAt | 102.8 | 40.7 / 81.8 | 65.3 | 32.4 / 38.2 | 34.3 / 37.4 |
| excalidraw | quickInfo | 42.2 | 4.9 / 33.9 | 6.9 | 1 / 2 | 0.1 / 0.4 |
| excalidraw | definition | 6.4 | 4.9 / 6.6 | 2 | 1 / 1.1 | 0.1 / 0.1 |
| excalidraw | fixes | 81.4 | 5.5 / 68.6 | 25.9 | 22.1 / 23.3 | 2.9 / 3.2 |
| excalidraw | nextSteps | 0.1 | 0 / 0 | n/a | n/a | n/a |

The product `diagnostics` warm call (30 to 60 ms) costs much more than raw TS (about 0 ms). The gap is atomicGate: it re-runs Smith on the file on every call.

## 3. Scoped against full, one-file change, widening, persistent hash index

These are the scopes used:

- **Line project (lending):** `features/<f>/**`, plus the other features' `index.ts` files (from moduleScope), plus `library/**`.
- **Other projects:** one folder chosen as the "feature", plus its direct imports inside the project:
  - commerce: `components/cart`
  - excalidraw: `packages/excalidraw/actions`
  - primitives: `library/components`

In the scoped runs, TypeScript's root files are the scope only and TS follows their imports. Smith and rules index the scope files only.

| project | scope (root files) | cold build scoped / full | TS files loaded scoped / full | completions at marker scoped / full | one-file change full: update + next diag | one-file change scoped | widen (add_to_scope) | peak RSS scoped / full | cold with persistent hash index full / scoped |
|---|---|--:|--:|--:|---|---|---|--:|--:|
| line-primitives | 40 + 0 | 9077 / 17228 ms | 40 / 95 | 1042 / 1121 | 223 + 46 ms; ts 1, smith 3, rules 1 | 207 + 24 ms | `test/kit/harness.tsx`: +204 ms (TS 9, rules 154), 41 files | 886 / 687 MB | **174 / 141 ms** |
| lending-starter | 13 (feature has no code) | 860 / 846 ms | 13 / 18 | 1000 / 1005 | 42 + 16 ms; ts 1, smith 1, rules 1 | 38 + 8 ms | n/a (only one feature) | 468 / 471 MB | **120 / 131 ms** |
| vercel-commerce | 7 + 6 | 891 / 1773 ms | 24 / 66 | 1045 / 1096 | 48 + 58 ms; ts 1, smith 5, rules 1 | 42 + 13 ms | `lib/shopify/index.ts`: +187 ms (TS 0.2; Smith 187), 24 files | 364 / 467 MB | **138 / 124 ms** |
| excalidraw | 49 + 51 | **3434 / 19326 ms** | 466 / 713 | 2871 / 3026 | 25 + 101 ms; ts 1, smith 2, rules 1 | 19 + 78 ms | `packages/math/src/index.ts`: +1.4 ms (already loaded through imports), 466 files | **569 / 865 MB** | **569 / 417 ms** |

- **Layers that re-ran on a one-file change:** `update()` re-ran only the changed file in all three layers (`ts: 1`, Smith = the number of functions in that file, `rules: 1`). TS re-parses lazily, on the next call, so the "next diag" number is where the TS cost shows up.
- **Peak RSS:** nothing came near 2 GB. The highest was excalidraw's full build at 865 MB. Excalidraw full against scoped is 865 against 569 MB. On the small projects the RSS differences are GC noise.
- **Completion lists barely shrink with scope** (excalidraw 3026 down to 2871), because the DOM lib globals dominate them. The product `completionsAt` caps its list at 30 items anyway, so scoping does not buy shorter completions.
- **Widening is cheap.** The new index file was usually in the TS program already through imports. The cost is Smith plus rules on that one file.

### What a hash-keyed persistent index saves on cold start

The persistent hash index stores Smith and rules results by content hash, so a cold start pays only for TS plus hashing. I simulated it with a second fresh process that read the stored per-(file, hash) results instead of recomputing them. Every file was a hit.

| project | cold today | of which reusable (Smith + rules) | of which not reusable (TS service) | cold with persistent hash index (memo load + hashing + TS) | saved |
|---|--:|--:|--:|--:|--:|
| line-primitives | 17.2 s | 16.6 s | 0.17 s | 0.17 s | 99% |
| lending-starter | 0.85 s | 0.86 s | 0.15 s | 0.12 s | 86% |
| vercel-commerce | 1.8 s | 1.7 s | 0.15 s | 0.14 s | 92% |
| excalidraw | 19.3 s | 19.9 s | 0.55 s | 0.57 s (scoped: 0.42 s) | 97% |

## 4. Background shadow indexer (excalidraw)

The prototype is in `measure.mjs`, phases `throttle` and `shadow`:

- **Process:** a separate child process at `nice -n 19`, started with `--max-old-space-size=1536`. The memory cap is 1536 MB, and the child stops if its RSS goes over it.
- **Order:** it indexes the 593 files outside the scope outward from the scope. It goes breadth-first over imports (364 files are reachable that way), then takes the rest.
- **Ticks:** N files per tick, with a 100 ms pause between ticks.
- **Gate:**
  - It pauses while another `heavy.sh` job holds `/tmp/construct-heavy.lock`. This run's own holder (`CONSTRUCT_HEAVY_HELD`) does not count.
  - It also pauses while free RAM (from `vm_stat`) is below heavy.sh's 3000 MB.
  - Waiting is capped at 5 minutes per run, so the bench always ends.
- **Foreground:** the scoped LSP calls `completionsAt` and `quickInfo` every 250 ms. The baseline is 40 calls with no background job.

| N files/tick | time to full coverage (of which paused) | coverage | avg CPU% | peak tick CPU% | max tick | peak RSS | +completionsAt p95 | +quickInfo p95 |
|--:|--:|---|--:|--:|--:|--:|--:|--:|
| 5 | 476 s (300 s paused, 176 s active) | 693/693 | 6.7 | 71.5 | 7.4 s | 623 MB | +423 ms | +17.7 ms |
| 20 | 361 s (300 s paused, 61 s active) | 693/693 | 2.8 | 28.8 | 6.8 s | 543 MB | +21.9 ms | +1.0 ms |
| 50 | 123 s (94 s paused, 29 s active) | 693/693 | 5.4 | 27.8 | 5.2 s | 531 MB | +7.5 ms | +0.5 ms |

**Picked N = 50.** It is the largest N tried, and the only one with added p95 under 20 ms and peak RSS under the cap.

- **The run was not clean.** Another agent's `heavy.sh` job (pid 31850, `bench/isolation`) took the lock while the throttle phase was running. The gate paused on it as designed: 300 s for N = 5 and N = 20, 94 s for N = 50, and 0 s on RAM. Part of the foreground samples were taken while that job was running, so the N = 5 latency in particular is probably contaminated. The ranking (bigger N is cheaper in total) has a structural cause; the next point explains it.
- **Why bigger N is cheaper in total:** each tick rebuilds the shadow TS program over a growing root set, about 1 s per tick on its own. Per-tick overhead dominates at small N.
- **The shadow job must be a separate process.** One tick takes up to 5 to 7 s, so an in-process tick would block a foreground call for seconds.
- The throttle phase first failed because `os.setPriority(19)` is refused under an already-niced parent. It was fixed (wrapped, since `nice -n 19` already applies) and only the throttle phase was re-run (`results.json` → `reruns`).

## Where this sits against UX thresholds

The thresholds are: under 100 ms is instant, under 1 s is fine, over 1 s is noticeable.

- **Warm calls are instant everywhere.** Every warm median is under 100 ms. The worst case is excalidraw full `diagnostics` at p95 99.5 ms, and `completionsAt` at about 40 ms.
- **Cold first calls are fine.** All are under 1 s; the worst is excalidraw `diagnostics` at 312 ms.
- **A one-file change is instant.** It takes 19 to 223 ms, plus 8 to 101 ms on the next diagnostics call.
- **The cold build is noticeable** on anything beyond toy size:
  - commerce 1.8 s
  - line-primitives 17 s
  - excalidraw 19 s
  - scoped excalidraw 3.4 s, scoped primitives 9 s
- **With a persistent hash index**, every cold start drops to 0.12 to 0.57 s, which is fine.

## Caveats

- **TS numbers are lower bounds.** No project had `node_modules`, because clones are parse only. So TS loaded no React or `@types`, and the TS service time (the part a hash index cannot reuse) will be higher on an installed project. I did not measure how much higher.
- **The rules cost depends on the profile:**
  - On commerce and excalidraw, which are not Construct projects, the default profile finds almost nothing to check: about 0.1 ms per file.
  - On a project with a Construct profile, line-primitives with its `architecture.yml`, rules cost about 146 ms per file and dominate the build.
  - A Construct-profiled project of excalidraw's size would add roughly 100 s of rules on a cold build. That is an extrapolation, not a measurement.
- **`nextSteps` has nothing to work on outside Line projects** (no `features/`), so its near-zero time says nothing there.

## Recommendations

- **Build the live index: yes, starting with the hash-keyed persistent index.** It saves 86 to 99% of every measured cold start (excalidraw 19.3 s → 0.57 s, line-primitives 17.2 s → 0.17 s). That is the one change that moves cold builds from noticeable to fine.
- **Scoped lazy loading should be the default for the first Smith and rules pass, not as a replacement for the full index.**
  - On its own, it cuts excalidraw from 19.3 to 3.4 s and peak RSS from 865 to 569 MB, but that is still noticeable.
  - With the hash index it only trims 0.57 to 0.42 s.
  - Widening costs about 0 to 200 ms per `add_to_scope`.
- **Pieces needed for large projects, based on these numbers:**
  - **Needed now:** the persistent hash index, then scoped first load with a background warm-up. The warm-up is a separate nice-19 shadow process, N = 50 files per tick, behind the heavy-lock and RAM gate. It filled excalidraw in 29 s of active time for +7.5 ms foreground p95.
  - **Not needed yet:** per-feature TS services with eviction. TS is 0.55 s and 865 MB peak at 700 files. Revisit at about 2000+ files, or once real `node_modules` and `@types` are in the program.
