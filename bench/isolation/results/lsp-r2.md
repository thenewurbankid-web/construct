# Line LSP isolation lsp-r2

2026-10-13. #943 (part of #941). Coder qwen2.5-coder:1.5b, driver qwen2.5-coder:7b, gatherer qwen3:4b. Rows: `lsp-r2.jsonl` (r1.jsonl's row format plus `lsp`). Command: see lsp-run.mjs header.

| Setup | | pass | delta | tokens (in+out) | model calls | wall | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| H | blocks: briefBuilder -> 1.5b best-of-5 (rerun) | 7/12 | - | 43170 | 40 | 77.2 s | brief 12761 tok fails: check 2, fragment 1, tsc 2 |
| L-gate | H + atomicGate as the third filter | 5/12 | -2 vs H | 51119 (+7949) | 48 | 92.5 s |  fails: check 3, fragment 1, tsc 2, gate 1 |
| L-norm | L-gate + atomic-codemod plug() on a gate-failing fill | 5/12 | +0 vs L-gate | 51119 (+0) | 48 | 97.6 s |  fails: check 3, fragment 1, tsc 2, gate 1 |

## L-gate

Samples the judge passed (tsc, and the task check on a task's last function): 15; the gate rejected 8 (53%). Reasons (a sample can fail several): smith 8. Template-exempt: 0.
Samples drawn: H 40, L-gate 48 (+8); wall H 77 s, L-gate 92 s; gate time 231 ms over 15 calls.
L-norm: 8 gate-failing fills normalized by plug(); changed 8, gate pass after 8, still tsc-clean 0, check 0, landable 0; Smith runtime imported in 8 (ifIt). First errors: TS2339: Property 'lengthOfItems' does not exist on type 'Book[]'..

## Gate on every passing fill (triples)

- H: 7 function(s) pass, 2 fail (smith 2); triples in triples.jsonl 7
- L-gate: 7 function(s) pass, 1 fail (smith 1); triples in triples.jsonl 7
- L-norm: 7 function(s) pass, 1 fail (smith 1); triples in triples.jsonl 7
- appended to results/triples.jsonl this run: 0

## Call latency (ms; cold = first call on a fresh service, warm = median of 5)

| call | cold | warm | output tokens |
| --- | --- | --- | --- |


L-enum points: 0 from r1 (tsc failures of arms A-D: TS2307 path, TS2305/2724 name, TS2339/2551 member, TS2304 import source).
