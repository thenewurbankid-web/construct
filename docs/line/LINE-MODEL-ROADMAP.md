# Line model (Line-1): roadmap for the next sprint

Owner decisions of 2026-10-12. Work starts once the current board reaches 100%, contract first.

## Decisions
- **Our own small model, trained from scratch.** It is not a fine-tune and not specific to any project. One model ships per Line version as `line-model@<line version>`: IR schema, tokenizer, weights and a model card.
- **The core speaks no English.** English passes through adapters:
  - Encoder (English → Line IR request): rules and the lexicon first, then a tiny English→IR model trained on Claude paraphrases. The small Qwen is only a fallback.
  - Decoder (IR → English): the existing summarizer, Smith and the refusal templates.
- **Trace-style generalized vocabulary, per piece.** No enumerated slots (F1, F2…). Each piece is a descriptor from a closed vocabulary:
  - kind, area and role (Trace's semantic roles);
  - layer, and its base's kind and role;
  - shape buckets: size, depth, child-role sequence and counts;
  - state: fit, gap, tie, stub or problem, plus finding codes;
  - typed edges.

  Outputs point into the input list or use relative tokens (self, its base, its feature, its user, new). Names come back only in the decoder, through the domain map.
- **Training data is only synthetic worlds** generated from that version's registries and rules and verified by Construct, plus curated paraphrases. User data is never used. Per-project knowledge exists only at runtime (the graph neighbourhood and memory recall), never in the weights.
- **It ships behind the decide() ladder:** static → Line-1 → Qwen → jev, with the rules-only fallback.
  - Release gate: it must beat rules + retrieval on that version's held-out eval. Otherwise that release falls back to static.
  - A version mismatch is refused in one sentence.

## Sprint steps
1. IR v0 spec, closed vocabulary and tokenizer. Build them from the tool registry, the intent catalog, the rule and fix codes, and the graph's node and edge types. Reserve spare ids.
2. Piece descriptor builder over the knowledge graph (G1). UI roles come from Trace's describe and grouper logic; data pieces get their roles from rules. Include the leak-guard test.
3. Data engine: scale Train Line's world generator to thousands of worlds. Produce IR → plan pairs verified by Construct, holding out whole worlds.
4. Core model v0 (5–30M parameters, grammar-constrained, pointer outputs), on Route only, trained locally. Compare it head to head with rules + retrieval, given perfect IR input.
5. Measure the encoder separately: the current classifier is the baseline, then the tiny English→IR model on generated paraphrases.
6. Release pipeline: train and eval each version in CI, with a model card and a hash-verified artifact.

The Pick and Repair skills come only after Route beats the baseline. Code fill stays with the small Qwen coder, behind tests.

## Reusable code (found 2026-10-12)
The vision-architect-pipeline repo, `packages/gatelm/` on its core-ship line (also visible in the worktrees `line-j3-j4`, `line-tc2` and `line-ac1-pr3`), has:
- `model/model.py`: a transformer, trained locally before. The earlier GateLM run reported 7.19 MB fp32 and 1.80 MB int8, trained in 13 minutes on an M5 Pro.
- `tokenizer/bpe.ts`: a byte-level BPE.
- `netlist/tokenize.ts`.
- Data and the BPE vocabulary in `runs/gatelm/data/` (`bpe.json`, `meta.json`).

Step 1 reuses the training loop and checkpointing. Line-1's tokenizer is a closed vocabulary rather than BPE, so the BPE serves only the English encoder.
