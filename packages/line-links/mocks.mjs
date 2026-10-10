// cu1 -- mocks of the linked Line modules, for adapter tests that must not need the source repo (contracts.d.ts).
// Each mock follows the real module's behaviour for the cases Construct uses, and no more.

/**
 * A mock of @mx/reason's `defineProfiles` + `runLadder` for pick questions: static options through the check; one
 * passing option decides (`single`); several go to the picker when it is up (`jev`), else static's order stands (`order`).
 * @param {{ fail?: boolean }} [o] `fail` makes runLadder throw, like a broken module.
 * @returns {import('./contracts').ReasonModule & { calls: number }}
 */
export function createMockReason(o = {}) {
  const mock = {
    calls: 0,
    defineProfiles(list) { return Object.fromEntries(list.map((p) => [p.pairId, { ...p }])); },
    async runLadder(items, tools) {
      mock.calls += 1;
      if (o.fail) throw new Error('mock reason failure');
      const choices = [];
      for (const it of items) {
        const passing = (it.options ?? []).filter((v) => tools.check(it.q, v, 'static') === null);
        let picked = null; let by = 'none'; let step = 'none';
        if (passing.length === 1) { picked = passing[0]; by = 'single'; step = 'static'; }
        else if (passing.length > 1) {
          const up = tools.picker ? await tools.picker.available(it.profile).catch(() => false) : false;
          if (up) { picked = passing[await tools.picker.pick(it.q, passing, it.profile)] ?? passing[0]; by = 'jev'; step = 'jev'; }
          else { picked = passing[0]; by = 'order'; step = 'static'; }
        }
        const options = picked === null ? [] : [picked, ...passing.filter((v) => v !== picked)];
        choices.push({ key: it.key, options, picked, by, step, lowConfidence: false, reasoning: [] });
      }
      return { choices, complete: true };
    },
  };
  return mock;
}

/**
 * A mock jev picker: always the option at `index` (clamped), and it records its calls.
 * @param {number} [index]
 * @param {{ available?: boolean }} [o]
 * @returns {import('./contracts').ReasonPicker & { calls: string[][] }}
 */
export function createMockPicker(index = 0, o = {}) {
  const calls = [];
  return {
    name: 'mock-jev',
    calls,
    async available() { return o.available ?? true; },
    async pick(_q, options) { calls.push([...options]); return Math.min(index, options.length - 1); },
  };
}

/**
 * A mock of @mx/plan's runner for registry tests: it checks a step against the registry the way plan's checks.ts does
 * (tool exists, args parse, kind matches) and runs it with `registry.call`, the only call the real runner makes.
 * @param {import('./contracts').PlanRegistry} registry
 */
export function createMockPlanRunner(registry) {
  const steps = [];
  return {
    steps,
    /** @returns {string | null} Why the step was refused, or null when added. */
    add(step) {
      const spec = registry.list().find((t) => t.name === step.tool);
      if (!spec) return `There is no tool named ${step.tool}.`;
      const parsed = spec.schema.safeParse(step.args ?? {});
      if (!parsed.success) return `The arguments do not fit ${step.tool}.`;
      if (step.kind !== undefined && step.kind !== spec.kind) return `The tool ${step.tool} is marked ${spec.kind}.`;
      steps.push({ ...step, kind: spec.kind, status: 'planned' });
      return null;
    },
    async runNext() {
      const s = steps.find((x) => x.status === 'planned');
      if (!s) return null;
      try { s.result = await registry.call(s.tool, s.args); s.status = 'done'; } catch (e) { s.error = e.message; s.status = 'failed'; }
      return s;
    },
  };
}
