// sampler (#941, arms E, H, I): draws up to N samples and keeps the first one that passes. The caller supplies the
// generator (one model call per sample, seed = seedBase + i) and the judge (edit -> tsc -> task check), so the same
// sampler serves whole-file (E) and function-splice (H, I) edits. Stops at the first pass; N=1/3/5 stats come from
// the same draw, since a pass at sample k means pass for every N >= k.
//
//   sample({ n, seedBase, generate(seed, i) -> { reply, ms }, judge(reply, i) -> { pass, tscOk, failClass, ms } })
//     -> { pass, picked, samples: [{ i, pass, tscOk, failClass, ms }], stats(Ns, baseMs) }

// Qwen2.5-Coder's published sampling for the 1.5b (generation_config.json).
export const QWEN_SAMPLING = { temperature: 0.7, top_p: 0.8, top_k: 20, repeat_penalty: 1.1 };

// #943: `gate(judgeResult, i) -> { pass, failed, ... }` is an optional third filter, run only on a sample the judge
// passed; the sample then passes only when the gate passes too (`prePass` keeps the judge's verdict, `gate` the gate's).
export async function sample({ n, seedBase = 1, generate, judge, gate = null }) {
  const samples = [];
  let picked = null;
  for (let i = 0; i < n; i++) {
    const g = await generate(seedBase + i, i);
    const j = await judge(g.reply, i);
    let gv = null; let gms = 0;
    if (gate && j.pass) { const t0 = Date.now(); gv = await gate(j, i); gms = Date.now() - t0; }
    const pass = Boolean(j.pass) && (!gv || Boolean(gv.pass));
    const s = { i, pass, prePass: Boolean(j.pass), gate: gv, tscOk: Boolean(j.tscOk), failClass: pass ? null : (j.pass ? 'gate' : j.failClass ?? null), ms: (g.ms ?? 0) + (j.ms ?? 0) + gms, result: j };
    samples.push(s);
    if (s.pass) { picked = s; break; }
  }
  const firstTsc = samples.findIndex((s) => s.tscOk);
  return {
    pass: Boolean(picked), picked: picked ?? samples[samples.length - 1], samples,
    // N stats from this draw. tscPickerPass: the first tsc-clean sample (a picker that cannot see the check) passes.
    stats(Ns, baseMs = 0) {
      return Object.fromEntries(Ns.map((N) => {
        const upto = Math.min(N, samples.length);
        const pass = picked != null && picked.i < N;
        return [N, { pass, tscPickerPass: firstTsc >= 0 && firstTsc < N && samples[firstTsc].pass,
          wallMs: baseMs + samples.slice(0, pass ? picked.i + 1 : upto).reduce((a, s) => a + s.ms, 0), drawn: upto }];
      }));
    },
  };
}
