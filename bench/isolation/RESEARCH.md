# Small-model techniques: ranked research summary (#941)

This is the research wave's ranking (2026-10-13) of the techniques we test in this harness. Arms E, F/F-sr and G
are in `config.mjs` and run in r2. The other items are rules that every r2 arm follows. The coordinator supplied
the citations for E, F and G. The harness agent added the URLs for the other items and did not re-verify them in
this session.

## Arms added in r2

1. **E: best-of-N, with tsc (then the task check) picking the winner.** Use B's driver brief, then draw N=5 samples
   from 1.5b at T 0.7, top_p 0.8 and top_k 20, and keep the first sample that passes. Report N=1/3/5 from the same
   samples. The brief estimated that N=5 costs about one 7b call. Measured wall times are in `results/r2.md`.
   - Large Language Monkeys (repeated sampling): https://arxiv.org/abs/2407.21787
   - CodeT (executable tests choose the sample): https://arxiv.org/abs/2207.10397
2. **F: whole-function splice with a code-shaped brief.** The driver names the exact function and gives its
   signature and prop types, the lines to change and one worked example. 1.5b returns only that function in a fenced
   block, and the harness splices it in by name (`lib/edit.mjs`). **F-sr** uses the same brief but takes the output
   as SEARCH/REPLACE blocks. We never use unified diffs.
   - CanItEdit (descriptive briefs beat lazy ones for 1.3b-7b): https://arxiv.org/abs/2312.12450
   - Diff-XYZ (Qwen2.5-Coder 1.5B scores 0.00 on udiff and 0.20 on search/replace): https://arxiv.org/abs/2510.12487
3. **G: FIM body-fill.** The driver writes the skeleton and signature with one `/*FILL*/` hole. 1.5b fills the
   hole through Ollama `/api/generate`, with `prompt` set to the prefix and `suffix` set to the suffix. Only the
   instruct tag `qwen2.5-coder:1.5b` is pulled; its Ollama template has the FIM branch. The base tag was not pulled.
   - Qwen2.5-Coder technical report (FIM training): https://arxiv.org/abs/2409.12186
   - Ollama generate API (`suffix`): https://github.com/ollama/ollama/blob/main/docs/api.md

## Owner and coordinator additions in r2 (no paper behind these: they test how much of the driver a block can replace)

- **H: deterministic blocks with no driver model.** `blocks/briefBuilder.mjs` uses the TS compiler API to
  produce the brief: the exact signature, the local and imported prop types, the fixture type, the SPEC excerpt and
  a per-kind worked example from `blocks/templates.mjs`. The coder is sampled through `blocks/sampler.mjs` (N up to
  5, Qwen settings), and `blocks/spliceApplier.mjs` splices the function in by name. It rejects anything that is not
  exactly one complete function with that name as `fragment`. Each block has its own node:test under `blocks/test/`.
- **I: a qwen3:4b driver that calls the same blocks through native Ollama `tools`.** The tools are brief (with
  optional intent text), code, splice, check and done. The driver gets at most 8 turns and 2 repair rounds. Sampling
  uses Qwen3's non-thinking settings (T 0.7, top_p 0.8, top_k 20) with `think: false` and `/no_think`.

## Rules for every arm from r2 on

4. **Each worker call gets at most about 1.5k tokens of context, starts fresh, and carries no history.** Every call
   is one system message plus one user message. The 1.5b prompt is trimmed to `workerBudgetTokens`: context files
   are shown as signatures only, and if the prompt is still too long they are dropped. Each row records
   `coderPromptMax`.
   - Lost in the Middle: https://arxiv.org/abs/2307.03172
5. **Allow at most 1-2 repairs, and have the 7b driver write the feedback.** This is arm C in r1 (2 repairs, with
   the driver re-instructing the coder).
   - Is Self-Repair a Silver Bullet for Code Generation?: https://arxiv.org/abs/2306.09896
6. **Use constrained JSON only for small choices, and never wrap code in JSON.** Our own probe found that code
   wrapped in JSON and qwen2.5-coder native tool calls both failed, so no arm uses either.
   - Let Me Speak Freely? (format restrictions hurt reasoning): https://arxiv.org/abs/2408.02442
7. **Use Qwen's own sampling settings for 1.5b: T 0.7, top_p 0.8, top_k 20, repetition_penalty 1.1.** In this
   harness that is the `qwen` sampling preset, which arm E uses. The single-sample arms stay greedy so they can be
   compared with A and B.
   - Qwen2.5-Coder-1.5B-Instruct generation_config: https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct/blob/main/generation_config.json
8. **Inline the exact prop types for TSX.** Context files go to the worker as their exported types and signatures,
   with function bodies elided (`signatures()` in `lib/edit.mjs`).
   - Monitor-guided decoding (type context for code LMs): https://arxiv.org/abs/2306.10763
