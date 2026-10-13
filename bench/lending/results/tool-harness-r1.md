# Tool harness r1 (#938): native tool calls per model

`packages/tools/dev/heavy.sh node bench/ecommerce/driver/tool-harness-probe.mjs`, 2026-10-13, Ollama 0.40.0,
num_ctx 16384, temperature 0.2, seed 7 (run twice; identical numbers for the qwen2.5-coder models). Raw turns:
`tool-harness-r1.json`. Replay set: 5 fixed builder turns + 5 real lending-qwen-7b-r1 turn inputs
(`tool-harness-replay.json`).

- **native**: the reply carried Ollama `message.tool_calls`. **right**: the first native call is a right tool (with the
  key arguments on the fixed cases). **valid**: its arguments pass the schema and the path-scope check.
- **text named right** (diagnostic only; the harness never parses text): a text answer at least named a right tool.
- **L1 right**: the layered turn's forced intent choice maps to a right tool.
- Subset: 5 tools per turn for 7b and qwen3:4b, 3 for 1.5b.

| model | config | native % | right % | valid % | calls/step | text named right % | L1 right % | median ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| qwen2.5-coder:7b | current/full | 0 | 0 | 0 | 1 | 60 | - | 1842 |
| qwen2.5-coder:7b | clean/full | 0 | 0 | 0 | 1 | 50 | - | 1839 |
| qwen2.5-coder:7b | clean/subset | 0 | 0 | 0 | 1 | 50 | - | 1529 |
| qwen2.5-coder:7b | layered | 0 | 0 | 0 | 2.8 | - | 50 | 2544 |
| qwen2.5-coder:1.5b | current/full | 0 | 0 | 0 | 1 | 40 | - | 387 |
| qwen2.5-coder:1.5b | clean/full | 0 | 0 | 0 | 1 | 40 | - | 379 |
| qwen2.5-coder:1.5b | clean/subset | 0 | 0 | 0 | 1 | 40 | - | 366 |
| qwen2.5-coder:1.5b | layered | 0 | 0 | 0 | 3 | - | 60 | 914 |
| qwen3:4b | current/full | 100 | 80 | 100 | 1 | - | - | 17767 |
| qwen3:4b | clean/full | 100 | 80 | 100 | 1 | - | - | 15727 |
| qwen3:4b | clean/subset | 100 | 60 | 100 | 1 | - | - | 27491 |
| qwen3:4b | layered | 50 | 20 | 50 | 2.2 | - | 30 | 41686 |

Findings:

- qwen2.5-coder (7b and 1.5b) never returns a native tool call, whatever the prompt or tool count, including the
  layered L2 that offers exactly one tool and says "Call <tool> now": it writes `{"name": ..., "arguments": ...}` as
  plain text (1.5b inside a ```json fence) without the `<tool_call>` tags its Ollama template asks for. Cleaning the
  prompt does not change that, so the prompt was not the cause.
- qwen3:4b calls natively every time; on the full set its two misses are `plan_add` where `plan_run_next` was right
  (r1-t8) and `plan_add` after the 3-refusals stop (r1-t7); the subset adds r1-t2 and r1-t3 to those misses.
- Neither the cleaned prompt, the per-turn subset nor the layered turn wins on right %: the profiles stay
  current/full and the layered turn ships off (it is in toolHarness.mjs, not wired into qwen-agent).
