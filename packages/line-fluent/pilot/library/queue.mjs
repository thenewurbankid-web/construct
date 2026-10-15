// Staged work queue for a library run (owner, 2026-10-15: "build queues so turns keep happening"). The stages used to
// run one after another over every entry: turn 2 waited until turn 1 had seen all 2,378 entries, the user stage until
// turn 2 had. Now each stage has its own queue of batches, and what a batch hands on (its refused entries) joins the
// next stage's queue at once, so turn 1, turn 2 and the user stage run side by side and the model's slots stay busy.
//
//   - a worker takes a batch from the latest stage that has one (finishing entries first), else from earlier ones
//   - a stage sends a full batch as soon as it has `size` entries; a partial batch only once every earlier stage is
//     drained (nothing queued, nothing running, nothing waiting), so batches stay full while work is still arriving
//   - stop() is checked before each batch; a worker with nothing to take waits for a running batch to finish

/**
 * @param {{name: string, initial?: any[], run: (group: any[]) => Promise<any[]|void>}[]} stages in order; each run
 *   returns the entries that go on to the next stage
 * @param {{size: number, workers: number, stop?: () => boolean}} options
 */
export async function stagedQueue(stages, { size, workers, stop = () => false }) {
  const state = stages.map((s) => ({ ...s, waiting: [...(s.initial ?? [])], ready: [], running: 0 }));
  const wakers = [];
  const notify = () => wakers.splice(0).forEach((w) => w());
  const drained = (i) => state.slice(0, i).every((s) => !s.waiting.length && !s.ready.length && !s.running);
  const fill = () => {
    state.forEach((s, i) => {
      while (s.waiting.length >= size) s.ready.push(s.waiting.splice(0, size));
      if (s.waiting.length && drained(i)) s.ready.push(s.waiting.splice(0));
    });
  };
  const take = () => {
    fill();
    for (let i = state.length - 1; i >= 0; i--) if (state[i].ready.length) return [i, state[i].ready.shift()];
    return null;
  };
  const worker = async () => {
    for (;;) {
      if (stop()) return;
      const job = take();
      if (!job) {
        if (!state.some((s) => s.running)) return;
        await new Promise((resolve) => wakers.push(resolve));
        continue;
      }
      const [i, group] = job;
      state[i].running += 1;
      try {
        const next = await state[i].run(group);
        if (state[i + 1] && next?.length) state[i + 1].waiting.push(...next);
      } finally {
        state[i].running -= 1;
        notify();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, workers) }, worker));
}
