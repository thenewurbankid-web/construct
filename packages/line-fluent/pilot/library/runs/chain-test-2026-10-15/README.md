# Chain vs single call, 2026-10-15

Same 30 entries (`--sections BigInt64Array,String --limit 30`, all 30 are BigInt64Array), qwen2.5-coder:7b on
llama-server (4 slots), `--build --jobs 8 --batch 5 --user none`. The full 7b run was paused for this and resumed after.

| | single call (batched) | chain (`--chain`) |
|---|---|---|
| wall time | 106 s | 6,034 s |
| passed the gate | 7 / 30 | 11 / 30 |
| of which real atoms (new or existing) | 0 | 4 |
| not-expressible | 7 | 7 |
| in the library | 0 | 4 |

- The chain's 4 real atoms are one sentence shape: `clones().list(arrayLike).and().maps().from(mapfn).to(thisArg)`.
  It passes the gate, but `to(thisArg)` misreads thisArg. Coverage is real, the wording is weak.
- 14 entries ended at the frame step: the 7b gave no js/params the gate's generator names allow (there is no
  typed-array generator, so a BigInt64Array receiver cannot be typed).
- Cost: 96 jev letter picks and 79 proposals for 58 attempts. Each pick is calibrated and rotated (2 asks per
  rotation, a rotation per option, a second round past 5 options), and the scratchpads change every prompt, so the
  server's prompt cache rarely helps. Median 37 s per entry against about 5 s.
- Scratchpads compacted 59 times in all (shared 25, frame 15, shape 12, decide 6, verb 1).

Next, if the chain is kept: no rotation for the shape pick (or at most 5 shapes, one round), pads after the fixed
prompt so the cache holds, and a test set the gate can type (Array/String entries the rules cannot build).
