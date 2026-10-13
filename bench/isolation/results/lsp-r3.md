# Line LSP isolation lsp-r3

2026-10-13. #943 (part of #941). Coder qwen2.5-coder:1.5b, driver qwen2.5-coder:7b, gatherer qwen3:4b. Rows: `lsp-r3.jsonl` (r1.jsonl's row format plus `lsp`). Command: see lsp-run.mjs header.

| Setup | | pass | delta | tokens (in+out) | model calls | wall | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| H | blocks: briefBuilder -> 1.5b best-of-5 (rerun) | 7/12 | - | 43170 | 40 | 68.3 s | brief 12761 tok fails: check 2, fragment 1, tsc 2 |
| L-gate | H + atomicGate as the third filter | 7/12 | +0 vs H | 43170 (+0) | 40 | 72.7 s |  fails: check 2, fragment 1, tsc 2 |
| L-gate-canon | L-gate + Smith plan check (canonical mode, reference plan) | 0/12 | -7 vs H | 63180 (+20010) | 60 | 99.0 s |  fails: gate 4, check 4, fragment 2, tsc 2 |

Smith for every gate setup (L-gate, L-gate-canon) and for the triples: atomic-codemod cbc25671d1a64fe825402d3ce19433657b945f4c (/Users/shashank/Repositories/atomic-codemod-hardening), input raw TS/TSX as written (LSP_SMITH_RAW=1), drift allowed: true. H runs no Smith.

## L-gate

Samples the judge passed (tsc, and the task check on a task's last function): 9; rejected 0 (0%). Reasons (a sample can fail several): -. Template-exempt: 0.
Samples drawn: H 40, L-gate 40 (+0); wall H 68 s, L-gate 73 s; gate time 149 ms over 9 calls.

## L-gate-canon

Samples the judge passed (tsc, and the task check on a task's last function): 25; rejected 25 (100%). Reasons (a sample can fail several): plan 25. Template-exempt: 0.
Samples drawn: H 40, L-gate-canon 60 (+20); wall H 68 s, L-gate-canon 99 s; gate time 630 ms over 25 calls.
Plan check (canonical Smith of the fill vs canonical Smith of the task's reference, which makes the reference the oracle): 25 checked, 25 rejected. Examples: BookPage: missing "it returns shows a <detailpage> with title as item's title and back as back containing a <p> containing 'by' and item's author and a <p> containing item's genre and a <p> containing string of item's year and a <p> containing string of item's pages and a <p> containing item's summary and a <p> containing string of item's available", extra "it returns shows a <detailpage> with title as item's title and back as back containing a <h1> containing item's title and a <p> containing 'by' and item's author and a <p> containing item's genre and a <p> containing string of item's year and a <p> containing string of item's pages and 'pages' and a <p> containing item's summary and a <p> containing if item's available then 'available', otherwise 'not available'"; BookPage: missing "it returns shows a <detailpage> with title as item's title and back as back containing a <p> containing 'by' and item's author and a <p> containing item's genre and a <p> containing string of item's year and a <p> containing string of item's pages and a <p> containing item's summary and a <p> containing string of item's available", extra "it returns shows a <detailpage> with title as item's title and back as back containing a <h1> containing item's title and a <p> containing 'by' and item's author and a <p> containing item's genre and a <p> containing string of item's year and a <p> containing string of item's pages and 'pages' and a <p> containing item's summary and a <p> containing string of if item's available then 'available', otherwise 'not available'".

## t09 reference under this Smith

Gate: pass. Smith: "Browse page works in 2 steps." "Let items be list books of an empty object." "It returns shows a <ListPage> with title as 'Library catalogue' and empty as a <p> containing 'No books yet.' containing items's length > 0 and items map a <article> with key as item's id and class name as 'flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm' containing a <h2> with class name as 'text-lg font-semibold' containing a <Link> with href as text of '/books/' and item's id containing item's title and a <p> containing item's author and a <p> containing item's genre and a <p> containing string of item's year and a <p> containing if item's available then 'Available', otherwise 'On loan'."

## L-norm: dropped

plug() cannot normalize a fill that works on plain data rows, so L-norm is dropped. Evidence from lsp-r2 (`lsp-r2.md`): all 8 gate-failing fills were changed by plug() and then passed the gate, but 0 compiled and 0 passed the check, even with Smith's runtime (`ifIt`, from @smith/core) imported. plug() turns property reads into accessor calls (`items.length` -> `items.lengthOfItems()`, `item.title` -> `item.titleOfItem()`; TS2339 on `Book[]`/`Book`), and Smith's comparisons delegate to the value itself (`Subject.greaterThan` calls `value.greaterThan`, smith src/index.ts). Those methods exist only on Smith objects (Organism / Chain) that carry them, never on the JSON rows a service returns, so a runtime import cannot make the normalized fill run.

## Gate on every passing fill (triples)

- H: 9 function(s) pass, 0 fail (-); triples in triples.jsonl 9
- L-gate: 9 function(s) pass, 0 fail (-); triples in triples.jsonl 9
- appended to results/triples.jsonl this run: 4

## Call latency (ms; cold = first call on a fresh service, warm = median of 5)

| call | cold | warm | output tokens |
| --- | --- | --- | --- |


L-enum points: 0 from r1 (tsc failures of arms A-D: TS2307 path, TS2305/2724 name, TS2339/2551 member, TS2304 import source).
