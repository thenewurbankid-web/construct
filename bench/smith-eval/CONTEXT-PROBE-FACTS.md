# Context probe: compiled facts vs hand-written facts (#946, after #925)

F1/CF1 = packages/engine/lsp/facts.mjs compileFacts (hardened Smith atomic-codemod cbc2567 + LSP index, no model); F2/CF2 = glossFacts (qwen2.5-coder:1.5b, guard kept both ledgers). L+tools and CLr1 are the hand-written r1 winners. Case 1, 7b: F1 ties L+tools (4/5 useful), F2 2/5; 1.5b 0/5 on every case-1 arm. Case 2: CF1 and CF2 match CLr1 at 5/5 on both models; CF2 uses the fewest tokens (944).

Source run: `lending-qwen-7b-r1` (read-only). Ollama 0.40.0; models qwen2.5-coder:7b, qwen2.5-coder:1.5b; temperature 0.2, seeds 1,2,3,4,5, num_predict 1500. Harness: `bench/ecommerce/driver/context-probe.mjs`; raw samples: `bench/smith-eval/context-probe-facts.json` (each ledger under meta.facts).

English = "Smith translation": TypeScript transpileModule (types and JSX removed) -> each function -> packages/summarize/links.mjs summarizeCode (atomic-codemod to-english via packages/line-links). The atomic-codemod link is ready from /Users/shashank/Repositories/atomic-codemod-hardening at commit cbc2567.

tsc sanity on the copied project: skeleton passes, failing attempt fails, example fix passes.

## Case 1: PicksPage TS2345 loop (turn 12)

| variant | model | what changed | num_ctx | setCode x/5 | repeat x/5 | tsc-pass x/5 | useful pass x/5 | lenient useful x/5 | skeleton resent x/5 | imports a missing module x/5 | prompt tokens | latency ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L+tools | 7b | L without the pack; read_file/list_dir/plan_status answered from project/ (up to 4 calls) | 16384 | 5/5 | 0/5 | 5/5 | 4/5 | 4/5 | 1/5 | 0/5 | 1532 | 4755 |
| F1 | 7b | L+tools with the ledger compiled by facts.mjs (hardened Smith steps + LSP index, no model) | 16384 | 5/5 | 0/5 | 5/5 | 4/5 | 4/5 | 1/5 | 0/5 | 1721 | 4608 |
| F2 | 7b | L+tools with the ledger from the 1.5b translator (glossFacts, guarded; compiler on a drop) | 16384 | 5/5 | 0/5 | 5/5 | 2/5 | 2/5 | 3/5 | 0/5 | 1533 | 4200 |
| L+tools | 1.5b | L without the pack; read_file/list_dir/plan_status answered from project/ (up to 4 calls) | 16384 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 1542 | 1052 |
| F1 | 1.5b | L+tools with the ledger compiled by facts.mjs (hardened Smith steps + LSP index, no model) | 16384 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 1731 | 1096 |
| F2 | 1.5b | L+tools with the ledger from the 1.5b translator (glossFacts, guarded; compiler on a drop) | 16384 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 1543 | 1068 |

L+tools / CL+tools: latency sums every call of the fetch loop (up to 4); prompt tokens are the last call's.

Compare-loop rows (V7, V8+V7): prompt tokens are the second call's; latency is both calls together.

## Case 2: base page for browse (turn 1)

| variant | model | what changed | ListPage pick (valid plan_add) x/5 | ListPage intent x/5 | answers | prompt tokens | latency ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CLr1 | 7b | CL replayed with the exact text r1 sent (pinned Smith English pack) | 5/5 | 5/5 | ListPage; ListPage; ListPage; ListPage; ListPage | 1106 | 1371 |
| CF1 | 7b | CL with the ledger compiled by facts.mjs (hardened Smith steps + LSP index, no model) | 5/5 | 5/5 | ListPage; ListPage; ListPage; ListPage; ListPage | 1366 | 1535 |
| CF2 | 7b | CL with the ledger from the 1.5b translator (glossFacts, guarded; compiler on a drop) | 5/5 | 5/5 | ListPage; ListPage; ListPage; ListPage; ListPage | 944 | 1381 |
| CLr1 | 1.5b | CL replayed with the exact text r1 sent (pinned Smith English pack) | 5/5 | 5/5 | ListPage; ListPage; ListPage; ListPage; ListPage | 1106 | 422 |
| CF1 | 1.5b | CL with the ledger compiled by facts.mjs (hardened Smith steps + LSP index, no model) | 5/5 | 5/5 | ListPage; ListPage; ListPage; ListPage; ListPage | 1366 | 431 |
| CF2 | 1.5b | CL with the ledger from the 1.5b translator (glossFacts, guarded; compiler on a drop) | 5/5 | 5/5 | ListPage; ListPage; ListPage; ListPage; ListPage | 944 | 393 |

## Atom sentences (V9a/V9b, C9a/C9b)

Candidates: all 14 registered atoms (packages/line-atoms, `toSmithEntry(...).english`). Reference from the spec point text: PCK-1 = no registered atom, MISSING only; BRW-1/BRW-2 = [client-pagination] plus MISSING for the row rendering.

| variant | model | atom lines (mean) | valid-atom % | reference match x/5 | real MISSING x/5 | MISSING restating an atom x/5 | schema-valid x/5 | atoms picked | prompt tokens | latency ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Atom gaps (what the points need that the registry lacks): PCK-1: Read a list kept in the browser (localStorage), empty when nothing is kept. Count the items of a list. Show a link whose label is a text followed by a count in brackets. BRW-1: Show each item of a list with its fields and a link to its own page. Say "Available" or "On loan" from a yes/no field.

<!-- WINNER -->

