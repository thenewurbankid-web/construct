# Context probe r1 (#925)

<!-- CONCLUSION -->

Source run: `lending-qwen-7b-r1` (read-only). Ollama 0.40.0; models qwen2.5-coder:7b, qwen2.5-coder:1.5b; temperature 0.2, seeds 1,2,3,4,5, num_predict 1500. Harness: `bench/ecommerce/driver/context-probe.mjs`; raw samples: `bench/lending/results/context-probe-r1.json`.

English = "Smith translation": TypeScript transpileModule (types and JSX removed) -> each function -> packages/summarize/links.mjs summarizeCode (atomic-codemod to-english via packages/line-links). The atomic-codemod link is ready from /Users/shashank/Desktop/atomic-codemod at commit 885b32e.

tsc sanity on the copied project: skeleton passes, failing attempt fails, example fix passes.

## Case 1: PicksPage TS2345 loop (turn 12)

| variant | model | what changed | num_ctx | setCode x/5 | repeat x/5 | tsc-pass x/5 | imports a missing module x/5 | prompt tokens | latency ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| V0 | 7b | control: turn-input/12 as sent | 16384 | 5/5 | 5/5 | 0/5 | 0/5 | 14935 | 9367 |
| V1 | 7b | compacted: repeats collapsed + (repeated N times), old tool outputs -> first line, done steps -> count | 32768 | 2/5 | 0/5 | 0/5 | 2/5 | 6476 | 14751 |
| V2 | 7b | V1 + context pack on the latest refusal (current file+hash, ListPage props, picks points, landed BookPage) | 32768 | 5/5 | 0/5 | 0/5 | 5/5 | 7312 | 25635 |
| V3 | 7b | V2 + example fix line in the refusal | 32768 | 4/5 | 0/5 | 0/5 | 4/5 | 7337 | 20897 |
| V4 | 7b | V3 with the refusal shortened to error + example fix + one-line rule | 32768 | 4/5 | 0/5 | 0/5 | 4/5 | 6768 | 20787 |
| V5 | 7b | best of V2-V4 + English (Smith translation) beside each code block of the pack (best = V4) | 32768 | 5/5 | 0/5 | 0/5 | 4/5 | 7023 | 22239 |
| V7 | 7b | best of V2-V4, then compare loop: its code in English beside the PCK-1 text, ask once more (2 calls) (best = V4) | 32768 | 4/5 | 0/5 | 0/5 | 4/5 | 7312 | 41159 |
| V8 | 7b | V1 with every code block replaced by English; raw code only the edited file + error line; English refusal + example fix | 32768 | 5/5 | 0/5 | 0/5 | 0/5 | 6248 | 7278 |
| V8+V7 | 7b | V8, then the compare loop (2 calls) | 32768 | 5/5 | 0/5 | 0/5 | 0/5 | 6520 | 11914 |
| V10 | 7b | V4 with the trailing repeated plan_status pair dropped (the refusal is the last message) | 32768 | 5/5 | 0/5 | 4/5 | 0/5 | 5762 | 4694 |
| V0 | 1.5b | control: turn-input/12 as sent | 16384 | 5/5 | 5/5 | 0/5 | 0/5 | 14935 | 3383 |
| V1 | 1.5b | compacted: repeats collapsed + (repeated N times), old tool outputs -> first line, done steps -> count | 32768 | 5/5 | 0/5 | 0/5 | 1/5 | 6476 | 4205 |
| V2 | 1.5b | V1 + context pack on the latest refusal (current file+hash, ListPage props, picks points, landed BookPage) | 32768 | 5/5 | 0/5 | 1/5 | 2/5 | 7312 | 1910 |
| V3 | 1.5b | V2 + example fix line in the refusal | 32768 | 5/5 | 0/5 | 3/5 | 2/5 | 7337 | 2158 |
| V4 | 1.5b | V3 with the refusal shortened to error + example fix + one-line rule | 32768 | 3/5 | 0/5 | 0/5 | 2/5 | 6768 | 4515 |
| V5 | 1.5b | best of V2-V4 + English (Smith translation) beside each code block of the pack (best = V3) | 32768 | 4/5 | 0/5 | 0/5 | 1/5 | 7591 | 3455 |
| V7 | 1.5b | best of V2-V4, then compare loop: its code in English beside the PCK-1 text, ask once more (2 calls) (best = V3) | 32768 | 5/5 | 0/5 | 0/5 | 2/5 | 7747 | 4674 |
| V8 | 1.5b | V1 with every code block replaced by English; raw code only the edited file + error line; English refusal + example fix | 32768 | 0/5 | 0/5 | 0/5 | 0/5 | 6248 | 1367 |
| V8+V7 | 1.5b | V8, then the compare loop (2 calls) | 32768 | 0/5 | 0/5 | 0/5 | 0/5 | 6248 | 1367 |
| V10 | 1.5b | V4 with the trailing repeated plan_status pair dropped (the refusal is the last message) | 32768 | 5/5 | 3/5 | 2/5 | 0/5 | 5762 | 1832 |

Compare-loop rows (V7, V8+V7): prompt tokens are the second call's; latency is both calls together.

## Case 2: base page for browse (turn 1)

| variant | model | what changed | ListPage pick (valid plan_add) x/5 | ListPage intent x/5 | answers | prompt tokens | latency ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C0 | 7b | control: turn-input/1 as sent (the DetailPage suggestion in place) | 0/5 | 0/5 | plan_add line.baseOn (DetailPage); plan_add line.baseOn (DetailPage); plan_add line.baseOn (DetailPage); plan_add line.baseOn (DetailPage); plan_add line.baseOn (DetailPage) | 3616 | 2217 |
| C1 | 7b | wrong DetailPage suggestion removed + ListPage/DetailPage/FormPage props + BRW-1/BRW-2 | 4/5 | 5/5 | line.baseOn (ListPage); ListPage; ListPage; ListPage; ListPage | 4009 | 4132 |
| C2 | 7b | C1 + one worked example of a ListPage-based page | 1/5 | 1/5 | ListPage; plan_status; plan_status; plan_status; plan_status | 4145 | 775 |
| C3 | 7b | C2 + English (Smith translation) of each library page | 0/5 | 1/5 | line.baseOn (ListPage); plan_status; plan_status; plan_status; plan_status | 4325 | 735 |
| C4 | 7b | C1 with the library pages only as English (no code) | 5/5 | 5/5 | ListPage; ListPage; ListPage; ListPage; ListPage | 3929 | 1682 |
| C0 | 1.5b | control: turn-input/1 as sent (the DetailPage suggestion in place) | 0/5 | 0/5 | line.createFeature; line.baseOn (DetailPage); line.baseOn (DetailPage); line.createFeature; line.baseOn (DetailPage) | 3616 | 950 |
| C1 | 1.5b | wrong DetailPage suggestion removed + ListPage/DetailPage/FormPage props + BRW-1/BRW-2 | 0/5 | 0/5 | line.baseOn (pages); line.createFeature; line.baseOn (library); line.baseOn (pages); line.baseOn (library) | 4009 | 611 |
| C2 | 1.5b | C1 + one worked example of a ListPage-based page | 0/5 | 5/5 | line.baseOn (ListPage); line.baseOn (ListPage); line.baseOn (ListPage); line.baseOn (ListPage); line.baseOn (ListPage) | 4145 | 328 |
| C3 | 1.5b | C2 + English (Smith translation) of each library page | 0/5 | 5/5 | line.baseOn (ListPage); line.baseOn (ListPage); line.baseOn (ListPage); line.baseOn (ListPage); line.baseOn (ListPage) | 4325 | 384 |
| C4 | 1.5b | C1 with the library pages only as English (no code) | 0/5 | 0/5 | line.baseOn (pages); line.baseOn (library); line.baseOn (pages); line.baseOn (pages); line.baseOn (pages) | 3929 | 347 |

## Atom sentences (V9a/V9b, C9a/C9b)

Candidates: all 14 registered atoms (packages/line-atoms, `toSmithEntry(...).english`). Reference from the spec point text: PCK-1 = no registered atom, MISSING only; BRW-1/BRW-2 = [client-pagination] plus MISSING for the row rendering.

| variant | model | atom lines (mean) | valid-atom % | reference match x/5 | real MISSING x/5 | MISSING restating an atom x/5 | schema-valid x/5 | atoms picked | prompt tokens | latency ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| V9a | 7b | 11 | 100 | 0/5 | 0/5 | 1/5 | - | async-status, filter-sort, client-pagination, optimistic-update, infinite-list, debounced-search, csv-export, date-range, permission-check, validated-submit, multi-step-flow, paginated-query, undo-history, polling | 5814 | 6519 |
| V9b | 7b | 8 | 100 | 0/5 | 0/5 | 0/5 | 5/5 | async-status, filter-sort, client-pagination, infinite-list, optimistic-update, paginated-query, permission-check, polling, debounced-search, undo-history, date-range | 5814 | 4465 |
| C9a | 7b | 6 | 100 | 0/5 | 0/5 | 0/5 | - | async-status, filter-sort, client-pagination, infinite-list, optimistic-update, debounced-search, paginated-query, permission-check, multi-step-flow | 3571 | 2914 |
| C9b | 7b | 5 | 100 | 0/5 | 0/5 | 0/5 | 5/5 | async-status, client-pagination, filter-sort, paginated-query, optimistic-update, infinite-list | 3571 | 2942 |
| V9a | 1.5b | 11 | 100 | 0/5 | 0/5 | 1/5 | - | async-status, client-pagination, csv-export, date-range, debounced-search, filter-sort, infinite-list, multi-step-flow, optimistic-update, paginated-query, permission-check, polling, undo-history, validated-submit | 5814 | 2386 |
| V9b | 1.5b | 8 | 100 | 0/5 | 0/5 | 0/5 | 5/5 | async-status, client-pagination, csv-export, date-range, debounced-search, filter-sort, infinite-list, multi-step-flow | 5814 | 1660 |
| C9a | 1.5b | 14 | 40 | 0/5 | 0/5 | 0/5 | - | async-status, client-pagination, csv-export, date-range, debounced-search, filter-sort, infinite-list, multi-step-flow, optimistic-update, paginated-query, permission-check, polling, undo-history, validated-submit | 3571 | 2473 |
| C9b | 1.5b | 8 | 100 | 0/5 | 0/5 | 0/5 | 5/5 | async-status, client-pagination, csv-export, date-range, debounced-search, filter-sort, infinite-list, multi-step-flow | 3571 | 1924 |

Atom gaps (what the points need that the registry lacks): PCK-1: Read a list kept in the browser (localStorage), empty when nothing is kept. Count the items of a list. Show a link whose label is a text followed by a count in brackets. BRW-1: Show each item of a list with its fields and a link to its own page. Say "Available" or "On loan" from a yes/no field.

<!-- WINNER -->

