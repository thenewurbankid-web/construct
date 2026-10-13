# Context probe r1 (#925)

## Conclusion

**English vs code.** As produced today, English made from code does not beat code, but a short ledger of hand-distilled English facts does.
- Today's English comes from to-english applied to transpiled TSX, and it is almost empty for pages ("List page using ? works in 1 step. It returns React create element 'main' and (...)"). Props are lost and the failing expression becomes "(...)".
- Putting it beside the code (V5, C3) gained nothing.
- Replacing code with it in the history (V8) is harmful:
  - 7b copied the English placeholder in as the file's code (5/5).
  - 1.5b produced broken JSON (5/5).
- The compare loop (V7, V8+V7) never changed 7b's code (0/5), doubled latency and gained nothing.
- In case 2, the English-only library pages (C4) got 7b to 5/5 ListPage picks, against 4/5 with props code (C1), at about 80 fewer tokens. 1.5b still got 0/5.

**What works: a fresh small context (L).** It has short rules, a ledger of one-sentence facts with cites, the current step, and the last refusal with an example fix. The edited file stays as raw code, and the model can call tools to read more.
- Case 1, 7b, L+tools: a useful tsc pass in 4/5 at 1,532 prompt tokens and 4.3 s. That is as good as the best long variant, V10 (4/5 at 5,762 tokens), and far better than the control V0 (0/5, with the same failing call resent 5/5, at 14,935 tokens).
- Case 2, CL: a valid ListPage pick in 5/5 for **both** 7b and 1.5b, at 1,106 tokens. This is the only shape where 1.5b sends a valid plan_add in case 2.

**1.5b does not match 7b on case 1.**
- 1.5b's best is V10 at 2/5 useful, and it resends the failing code in 3/5.
- In L and L+tools, 1.5b copies the failing line (or the old skeleton) in as the whole file: 0/5.

**Atom sentences (V9, L9, C9, CL9): 0/5 reference matches everywhere, for both models.**
- The models list most of the registry (5–14 lines) instead of picking from it, and never write a real MISSING line.
- Ollama 0.40.0 honours the `format` enum schema: every V9b, L9b, C9b and CL9b answer was schema-valid, 5/5. That guarantees the vocabulary, not the choice: 1.5b returns the first 8 atoms in registry order.
- Writing code with the L shape is far ahead of thinking in atoms.

**Atom gaps the assembler needs.**
- PCK-1:
  - read a list kept in localStorage, empty by default;
  - count it;
  - show a link labelled with a text plus a count in brackets.
- BRW-1:
  - render each row's fields with a link to its own page;
  - show "Available" or "On loan" from a boolean.
- BRW-2 is the only point an existing atom covers (client-pagination).

Source run: `lending-qwen-7b-r1` (read-only). Ollama 0.40.0; models qwen2.5-coder:7b, qwen2.5-coder:1.5b; temperature 0.2, seeds 1,2,3,4,5, num_predict 1500. Harness: `bench/ecommerce/driver/context-probe.mjs`; raw samples: `bench/lending/results/context-probe-r1.json`.

English = "Smith translation": TypeScript transpileModule (types and JSX removed) -> each function -> packages/summarize/links.mjs summarizeCode (atomic-codemod to-english via packages/line-links). The atomic-codemod link is ready from /Users/shashank/Desktop/atomic-codemod at commit 885b32e.

tsc sanity on the copied project: skeleton passes, failing attempt fails, example fix passes.

## Case 1: PicksPage TS2345 loop (turn 12)

| variant | model | what changed | num_ctx | setCode x/5 | repeat x/5 | tsc-pass x/5 | useful pass x/5 | lenient useful x/5 | skeleton resent x/5 | imports a missing module x/5 | prompt tokens | latency ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| V0 | 7b | control: turn-input/12 as sent | 16384 | 5/5 | 5/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 14935 | 9367 |
| V1 | 7b | compacted: repeats collapsed + (repeated N times), old tool outputs -> first line, done steps -> count | 32768 | 2/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 2/5 | 6476 | 14751 |
| V2 | 7b | V1 + context pack on the latest refusal (current file+hash, ListPage props, picks points, landed BookPage) | 32768 | 5/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 5/5 | 7312 | 25635 |
| V3 | 7b | V2 + example fix line in the refusal | 32768 | 4/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 4/5 | 7337 | 20897 |
| V4 | 7b | V3 with the refusal shortened to error + example fix + one-line rule | 32768 | 4/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 4/5 | 6768 | 20787 |
| V5 | 7b | best of V2-V4 + English (Smith translation) beside each code block of the pack (best = V4) | 32768 | 5/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 4/5 | 7023 | 22239 |
| V7 | 7b | best of V2-V4, then compare loop: its code in English beside the PCK-1 text, ask once more (2 calls) (best = V4) | 32768 | 4/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 4/5 | 7312 | 41159 |
| V8 | 7b | V1 with every code block replaced by English; raw code only the edited file + error line; English refusal + example fix | 32768 | 5/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 6248 | 7278 |
| V8+V7 | 7b | V8, then the compare loop (2 calls) | 32768 | 5/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 6520 | 11914 |
| V10 | 7b | V4 with the trailing repeated plan_status pair dropped (the refusal is the last message) | 32768 | 5/5 | 0/5 | 4/5 | 4/5 | 4/5 | 0/5 | 0/5 | 5762 | 4694 |
| V0 | 1.5b | control: turn-input/12 as sent | 16384 | 5/5 | 5/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 14935 | 3383 |
| V1 | 1.5b | compacted: repeats collapsed + (repeated N times), old tool outputs -> first line, done steps -> count | 32768 | 5/5 | 0/5 | 0/5 | 0/5 | 0/5 | 1/5 | 1/5 | 6476 | 4205 |
| V2 | 1.5b | V1 + context pack on the latest refusal (current file+hash, ListPage props, picks points, landed BookPage) | 32768 | 5/5 | 0/5 | 1/5 | 0/5 | 0/5 | 4/5 | 2/5 | 7312 | 1910 |
| V3 | 1.5b | V2 + example fix line in the refusal | 32768 | 5/5 | 0/5 | 3/5 | 0/5 | 0/5 | 4/5 | 2/5 | 7337 | 2158 |
| V4 | 1.5b | V3 with the refusal shortened to error + example fix + one-line rule | 32768 | 3/5 | 0/5 | 0/5 | 0/5 | 0/5 | 2/5 | 2/5 | 6768 | 4515 |
| V5 | 1.5b | best of V2-V4 + English (Smith translation) beside each code block of the pack (best = V3) | 32768 | 4/5 | 0/5 | 0/5 | 0/5 | 0/5 | 3/5 | 1/5 | 7591 | 3455 |
| V7 | 1.5b | best of V2-V4, then compare loop: its code in English beside the PCK-1 text, ask once more (2 calls) (best = V3) | 32768 | 5/5 | 0/5 | 0/5 | 0/5 | 0/5 | 4/5 | 2/5 | 7747 | 4674 |
| V8 | 1.5b | V1 with every code block replaced by English; raw code only the edited file + error line; English refusal + example fix | 32768 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 6248 | 1367 |
| V8+V7 | 1.5b | V8, then the compare loop (2 calls) | 32768 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 6248 | 1367 |
| V10 | 1.5b | V4 with the trailing repeated plan_status pair dropped (the refusal is the last message) | 32768 | 5/5 | 3/5 | 2/5 | 2/5 | 2/5 | 0/5 | 0/5 | 5762 | 1832 |
| L | 7b | fresh small context: short rules + ledger facts + current step + last refusal (English + example fix) + English pack; plan_add only | 16384 | 0/5 | 0/5 | 0/5 | 0/5 | 5/5 | 0/5 | 0/5 | 1520 | 3418 |
| L+tools | 7b | L without the pack; read_file/list_dir/plan_status answered from project/ (up to 4 calls) | 16384 | 5/5 | 0/5 | 5/5 | 4/5 | 4/5 | 1/5 | 0/5 | 1532 | 4295 |
| L | 1.5b | fresh small context: short rules + ledger facts + current step + last refusal (English + example fix) + English pack; plan_add only | 16384 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 1520 | 728 |
| L+tools | 1.5b | L without the pack; read_file/list_dir/plan_status answered from project/ (up to 4 calls) | 16384 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 1542 | 952 |

L+tools / CL+tools: latency sums every call of the fetch loop (up to 4); prompt tokens are the last call's.

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
| CL | 7b | fresh small context: short rules + ledger facts (library pages in one sentence each) + current step with BRW-1/BRW-2 + English pack; plan_add only | 5/5 | 5/5 | ListPage; ListPage; ListPage; ListPage; ListPage | 1106 | 1245 |
| CL+tools | 7b | CL without the pack; read_file/list_dir/plan_status answered from project/ (up to 4 calls) | 5/5 | 5/5 | ListPage; ListPage; ListPage; ListPage; ListPage | 1113 | 1281 |
| CL | 1.5b | fresh small context: short rules + ledger facts (library pages in one sentence each) + current step with BRW-1/BRW-2 + English pack; plan_add only | 5/5 | 5/5 | ListPage; ListPage; ListPage; ListPage; ListPage | 1106 | 372 |
| CL+tools | 1.5b | CL without the pack; read_file/list_dir/plan_status answered from project/ (up to 4 calls) | 0/5 | 0/5 | read_file; read_file; read_file; read_file; read_file | 1303 | 796 |

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
| L9a | 7b | 4 | 100 | 0/5 | 0/5 | 0/5 | - | async-status, csv-export, optimistic-update, permission-check, paginated-query, polling, undo-history, validated-submit, filter-sort, client-pagination, debounced-search, infinite-list | 1636 | 1656 |
| L9b | 7b | 6 | 100 | 0/5 | 0/5 | 0/5 | 5/5 | async-status, date-range, filter-sort, optimistic-update, permission-check, polling, infinite-list, paginated-query | 1636 | 2847 |
| CL9a | 7b | 22 | 99 | 0/5 | 0/5 | 0/5 | - | async-status, client-pagination, infinite-list, optimistic-update, paginated-query, multi-step-flow, polling, date-range, filter-sort, validated-submit, permission-check, csv-export, debounced-search, undo-history | 1304 | 13788 |
| CL9b | 7b | 8 | 100 | 0/5 | 0/5 | 0/5 | 5/5 | async-status, client-pagination, optimistic-update, infinite-list, multi-step-flow, paginated-query, permission-check, polling | 1304 | 3999 |
| L9a | 1.5b | 11 | 100 | 0/5 | 0/5 | 1/5 | - | async-status, client-pagination, csv-export, date-range, debounced-search, filter-sort, infinite-list, multi-step-flow, optimistic-update, paginated-query, permission-check, polling, undo-history, validated-submit | 1636 | 1706 |
| L9b | 1.5b | 8 | 100 | 0/5 | 0/5 | 0/5 | 5/5 | async-status, client-pagination, csv-export, date-range, debounced-search, filter-sort, infinite-list, multi-step-flow | 1636 | 1329 |
| CL9a | 1.5b | 11 | 80 | 0/5 | 0/5 | 1/5 | - | async-status, client-pagination, csv-export, date-range, debounced-search, filter-sort, infinite-list, multi-step-flow, optimistic-update, paginated-query, permission-check, polling, undo-history, validated-submit | 1304 | 1618 |
| CL9b | 1.5b | 8 | 100 | 0/5 | 0/5 | 0/5 | 5/5 | async-status, client-pagination, csv-export, date-range, debounced-search, filter-sort, infinite-list, multi-step-flow | 1304 | 1314 |

Atom gaps (what the points need that the registry lacks): PCK-1: Read a list kept in the browser (localStorage), empty when nothing is kept. Count the items of a list. Show a link whose label is a text followed by a count in brackets. BRW-1: Show each item of a list with its fields and a link to its own page. Say "Available" or "On loan" from a yes/no field.

## What surprised us

- **V0 reproduces the loop**: the same failing call is resent 5/5 on both models.
- **Compaction alone stops the repeat (V1–V7: 0/5 repeats), but 7b then rewrites the whole page** for PCK-1 to PCK-6. In 2–5 of 5 samples it adds an invented `import { usePicks } from '../usecases/usePicks'` (TS2307).
  - The pattern comes from the rules card that plan_status prints (an example importing `'../usecases/useCart'`).
  - L's ledger fact "No feature has usecases, services or domains yet" removed it (0/5).
- **Order matters more than content.** V10 is V4 with the trailing, repeated plan_status pair dropped, so the refusal is the last message. That moves 7b from 0/5 to 4/5 useful.
  - In the real run, the model's own plan_status call after each "Stop" refusal buries the refusal.
  - The example fix line only helps when it sits in that last message.
- **A tsc pass is not enough.** 1.5b's tsc passes in V2 and V3 were the unchanged skeleton. The "useful pass" column also requires the code to contain "My picks" and not be the skeleton.
- **The worked example (C2, C3) made 7b call plan_status in 4/5** instead of acting.
- **Wrong call format.** Several 7b and 1.5b answers call `line.setCode` or `line.baseOn` directly instead of through plan_add. The real driver does not accept these.
  - "Intent" and "lenient" columns score them apart from the strict score.
  - L without fetch tools had 0/5 strict but 5/5 lenient-useful on 7b. After one read_file round trip (L+tools), 7b used plan_add correctly 5/5.
- **1.5b with fetch tools (CL+tools) loops on read_file 4 times** and never acts.

## Winning shape (for the builder-context work)

Case 1, 7b: **L+tools** (or V10 when the history is kept). Each turn is fresh: `[system: short rules, user: ledger + current step + last result + "Read a file with read_file when you need its code."]`, with tools plan_add, plan_status, read_file and list_dir. The exact text sent is in `context-probe-r1.json` under `prompts["L+tools@qwen2.5-coder:7b"]`. Its shape:

```
Facts so far (each with where it comes from):
- features/picks/pages/PicksPage.tsx is based on ListPage, served at /picks, and renders ListPage titled "Picks" with nothing else. [steps 6, 7; read]
- No feature has usecases, services or domains yet. [ls features/*]
- ListPage takes {title, toolbar?, children?, empty?}: ... [library/pages/ListPage.tsx]
- Your last 5 attempts at PicksPage.tsx were refused with the same type error (below). [steps refused]
  (... one line per landed item ...)

Current step: PCK-1: <point text>. Write it in features/picks/pages/PicksPage.tsx with plan_add line.setCode (the whole file, contentHash <hash>).

Last result: Refused (TYPE_ERROR, repeated 5 times): line 7 of features/picks/pages/PicksPage.tsx does not type-check: it passes a value that can be null (string | null) where only a string is allowed.
>7| const pickedBooks = JSON.parse(localStorage.getItem('picks')) || [];
Example fix for line 7: const pickedBooks = JSON.parse(localStorage.getItem('picks') ?? '[]');
Rule: send line.setCode with the whole file, line 7 changed, and contentHash <hash>; the same code again is refused.

Read a file with read_file when you need its code.
```

For 1.5b, leave the raw failing line (`>7| ...`) out of the refusal and show only the example fix. In L, 1.5b copied that line in as the whole file in 4/5 samples. This change is a suggestion and has not been tested here.

