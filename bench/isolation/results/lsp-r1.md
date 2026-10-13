# Line LSP isolation lsp-r1

2026-10-13. #943 (part of #941). Coder qwen2.5-coder:1.5b, driver qwen2.5-coder:7b, gatherer qwen3:4b. Rows: `lsp-r1.jsonl` (r1.jsonl's row format plus `lsp`). Command: see lsp-run.mjs header.

| Setup | | pass | delta | tokens (in+out) | model calls | wall | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B | 7b driver -> 1.5b (r1 B, rerun) | 7/12 | - | 25057 | 24 | 87.7 s |  fails: fragment 2, tsc 2, check 1 |
| L-fix | B + LSP fixes() after the reply | 7/12 | +0 vs B | 25057 (+0) | 24 | 87.7 s |  fails: fragment 2, check 3 |
| L-enum-free | 1.5b free text at r1 failure points | 0/9 | - | 3414 | 9 | 1.8 s |  fails: wrong 9 |
| L-enum | 1.5b picks from the completionsAt enum | 6/9 | +6 vs L-enum-free | 3670 (+256) | 9 | 2.1 s |  fails: wrong 3 |
| H | blocks: briefBuilder -> 1.5b best-of-5 (rerun) | 8/12 | - | 43838 | 40 | 89.2 s | brief 11934 tok fails: fragment 2, tsc 1, check 1 |
| L-brief | H with quickInfo/signatureAt types in the brief | 7/12 | -1 vs H | 39760 (-4078) | 39 | 76.6 s | brief 11220 tok fails: check 1, fragment 3, tsc 1 |
| L-gate | H + atomicGate as the third filter | 1/12 | -7 vs H | 62124 (+18286) | 58 | 112.1 s |  fails: fragment 7, tsc 2, gate 1, check 1 |
| L-norm | L-gate + atomic-codemod plug() on a gate-failing fill | 1/12 | +0 vs L-gate | 62124 (+0) | 58 | 116.6 s |  fails: fragment 7, tsc 2, gate 1, check 1 |
| L-gather-files | context by reading files (B driver input) | 12/12 | - | 0 | 0 | 0.0 s |  |
| L-gather | qwen3:4b gatherer, definition/references only | 1/12 | -11 vs L-gather-files | 35953 (+35953) | 13 | 395.4 s | context 25 vs files 4313 tok |
| L-gather-det | definition + quickInfo per context export, no model | 12/12 | +0 vs L-gather-files | 0 (+0) | 0 | 1.2 s | context 1392 vs files 4313 tok |
| L-rules-free | K3: 1.5b, free schema (steps x targets x reasons) | 3/8 | - | 2776 | 8 | 1.3 s |  |
| L-rules | K3: 1.5b picks from the nextSteps enum | 8/8 | +5 vs L-rules-free | 2816 (+40) | 8 | 0.9 s |  |
| L-rules-det | K3: nextSteps alone, no model | 8/8 | +5 vs L-rules-free | 0 (-2776) | 0 | 0.0 s |  |
| L-smith-exact | smithDiagnostics, exact template match | 12/12 | - | 0 | 0 | 0.0 s |  |
| L-smith-embed | smithDiagnostics + nomic-embed-text fallback | 8/12 | -4 vs L-smith-exact | 0 (+0) | 12 | 0.4 s |  |

## L-gate

Samples the judge passed (tsc, and the task check on a task's last function): 18; the gate rejected 15 (83%). Reasons (a sample can fail several): connections 15, smith 6. Template-exempt: 0.
Samples drawn: H 40, L-gate 58 (+18); wall H 89 s, L-gate 112 s; gate time 87 ms over 18 calls.
L-norm: 15 gate-failing fills normalized by plug(); changed 15, gate pass after 0, still tsc-clean 0, check 0, landable 0; Smith runtime imported in 0 (-). First errors: -.

## Gate on every passing fill (triples)

- B: 0 function(s) pass, 6 fail (connections 6, smith 2); triples in triples.jsonl 0
- L-fix: 0 function(s) pass, 6 fail (connections 6, smith 2); triples in triples.jsonl 0
- H: 3 function(s) pass, 7 fail (connections 7, smith 2); triples in triples.jsonl 7
- L-brief: 3 function(s) pass, 6 fail (connections 6, smith 1); triples in triples.jsonl 3
- L-gate: 3 function(s) pass, 1 fail (connections 1, smith 1); triples in triples.jsonl 7
- L-norm: 3 function(s) pass, 1 fail (connections 1, smith 1); triples in triples.jsonl 7
- appended to results/triples.jsonl this run: 0

## Call latency (ms; cold = first call on a fresh service, warm = median of 5)

| call | cold | warm | output tokens |
| --- | --- | --- | --- |
| diagnostics | 204 | 1 | 27 |
| fixes | 185 | 48 | 199 |
| completionsAt | 115 | 5 | 100 |
| quickInfo | 101 | 1 | 45 |
| signatureAt | 102 | 1 | 13 |
| definition | 113 | 1 | 60 |
| references | 93 | 1 | 95 |
| ruleDiagnostics | 244 | 42 | - |
| nextSteps | 5 | 4 | - |
| smithReferences | 0 | 0 | - |
| smithDefinition | 0 | 0 | - |
| smithCompletions | 0 | 1 | - |
| smithDiagnostics | 0 | 0 | - |
| atomicGate | 3 | 1 | - |

Dynamic index (K3 snapshot): full build 601 ms (20 functions), incremental update after adding one function 43 ms, new function in all three layers: true.

L-enum points: 9 from r1 (tsc failures of arms A-D: TS2307 path, TS2305/2724 name, TS2339/2551 member, TS2304 import source).
