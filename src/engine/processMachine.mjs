// #287 — the process lifecycle, as a real XState machine.
//
// Why a machine and not a status enum (the decision recorded on #287):
// Construct already models state machines as XState and already explains
// them in plain English (workflowNarrator.mjs) and as Given/When/Then
// scenarios (workflowScenarios.mjs). Modelling the process lifecycle the
// same way means "what can a process do next, and why" is answered by the
// same deterministic block that answers it for a user's own workflows —
// `narrateProcessLifecycle()` below is four lines and produces documentation
// that cannot drift from the implementation, because it IS the
// implementation. A hand-rolled `status` string would have needed its own
// prose, its own diagram and its own drift.
//
// Why no `xstate` dependency: `xstate` is a dependency of `ui/client` only,
// and core `src/` stays dependency-light. `PROCESS_MACHINE` is nevertheless a
// genuine XState **v5 config object** — `createMachine(PROCESS_MACHINE)`
// would work verbatim — and `transition()` below is a ~50-line deterministic
// interpreter of exactly the subset this machine uses (compound states,
// guarded transition arrays, targetless transitions, `#id.path` targets).
// test/processMachine.test.mjs proves the config is really XState-shaped by
// rendering it as source and running it through `workflowExtractor.mjs`, the
// same parser that reads users' machines, and asserting the description this
// file builds by hand matches the one the parser derives.
//
// Pure: no clock, no filesystem, no randomness, nothing async.
import { narrateMachine } from './workflowNarrator.mjs';
import { enumerateScenarios, findHealthIssues } from './workflowScenarios.mjs';

/** The lifecycle's top-level states — what a UI shows as "the state of this
 * process". `running` is compound; see RUNNING_SUBSTATES. */
export const PROCESS_STATES = Object.freeze(['queued', 'running', 'paused', 'failed', 'done', 'cancelled']);

/** Inside `running`: `active` is executing steps; `stopping` means a pause or
 * cancel has been asked for and the machine is waiting for the step in flight
 * to reach a yield point. Control is cooperative — a step cannot be torn down
 * mid-syscall — and this is how that truth is modelled without inventing a
 * seventh top-level state that #292's pill and list would have to learn. */
export const RUNNING_SUBSTATES = Object.freeze(['active', 'stopping']);

/** States a process can never leave. `failed` is deliberately NOT one: it
 * accepts RETRY, which is the control #292 lists next to pause and cancel. */
export const TERMINAL_STATES = Object.freeze(['done', 'cancelled']);

/** Every event the lifecycle understands. */
export const PROCESS_EVENTS = Object.freeze([
  'START', 'STEP_COMPLETED', 'STEP_FAILED', 'FINISHED', 'PAUSE', 'CANCEL', 'YIELDED', 'RESUME', 'RETRY',
]);

/**
 * The machine. Valid XState v5 config; see the header for why it is not fed
 * to `createMachine()` here.
 *
 * Shape of the lifecycle in one breath: a process is queued until something
 * starts it; while running it either works (`active`) or is winding down
 * because someone asked it to (`stopping`); a step failing fails the whole
 * process (recoverable with RETRY); running out of steps finishes it.
 */
export const PROCESS_MACHINE = Object.freeze({
  id: 'process',
  initial: 'queued',
  context: {
    processId: null,
    pendingControl: null,
    currentStepId: null,
    completedSteps: 0,
    totalSteps: 0,
  },
  states: {
    queued: {
      on: {
        START: { target: 'running', actions: ['markStarted'] },
        CANCEL: { target: 'cancelled', actions: ['markFinished'] },
      },
    },
    running: {
      initial: 'active',
      states: {
        active: {
          on: {
            STEP_COMPLETED: { actions: ['recordStepResult'] },
            PAUSE: { target: 'stopping', actions: ['requestPause'] },
            CANCEL: { target: 'stopping', actions: ['requestCancel'] },
          },
        },
        stopping: {
          on: {
            YIELDED: [
              { target: '#process.cancelled', guard: 'cancelRequested', actions: ['discardStepTransaction', 'markFinished'] },
              { target: '#process.paused', actions: ['discardStepTransaction'] },
            ],
          },
        },
      },
      on: {
        STEP_FAILED: { target: 'failed', actions: ['recordStepResult'] },
        FINISHED: { target: 'done', actions: ['markFinished'] },
      },
    },
    paused: {
      on: {
        RESUME: { target: 'running', actions: ['clearPendingControl'] },
        CANCEL: { target: 'cancelled', actions: ['markFinished'] },
      },
    },
    failed: {
      on: {
        RETRY: { target: 'running', actions: ['clearPendingControl'] },
        CANCEL: { target: 'cancelled', actions: ['markFinished'] },
      },
    },
    done: { type: 'final' },
    cancelled: { type: 'final' },
  },
});

/** The guards named in the config, as real predicates over a process context.
 * Kept beside the machine rather than inside it so the config stays plain
 * JSON (serialisable, inspectable, sendable to a UI). */
export const PROCESS_GUARDS = Object.freeze({
  cancelRequested: (context) => context?.pendingControl === 'cancel',
});

const STATE_INDEX = buildStateIndex();

/** Every state path the machine has, parents and children alike — the closed
 * set a persisted `state` field may hold, and the enum schemas/process.v1.json
 * mirrors. */
export const PROCESS_STATE_PATHS = Object.freeze([...STATE_INDEX.keys()]);

function buildStateIndex() {
  const byPath = new Map();
  const walk = (states, parentPath) => {
    for (const [name, node] of Object.entries(states || {})) {
      const path = parentPath ? `${parentPath}.${name}` : name;
      byPath.set(path, { path, name, parent: parentPath || null, node });
      if (node.states) walk(node.states, path);
    }
  };
  walk(PROCESS_MACHINE.states, '');
  return byPath;
}

/** `'running'` -> `'running.active'`: entering a compound state means entering
 * its initial child, recursively. XState's own rule. */
export function resolveEntry(statePath) {
  let cur = statePath;
  for (let i = 0; i < 10; i += 1) {
    const node = STATE_INDEX.get(cur)?.node;
    if (!node?.states || !node.initial) return cur;
    cur = `${cur}.${node.initial}`;
  }
  return cur;
}

/** The state a fresh process sits in, fully resolved. */
export function initialProcessState() {
  return resolveEntry(PROCESS_MACHINE.initial);
}

/**
 * `'running.active'` -> `'running'`. What #292's list and pill show.
 *
 * @param {string} statePath A dotted state path.
 * @returns {string} Its first segment.
 *
 * @example
 * topLevelState('running.active'); // => 'running'
 */
export function topLevelState(statePath) {
  return String(statePath || '').split('.')[0];
}

/** Resolve an XState target string the way workflowExtractor.mjs's
 * resolveTarget() does: `#id.path` against the machine id, otherwise relative
 * to the source state's parent, falling back to the machine root. */
function resolveTarget(target, fromPath) {
  if (target.startsWith('#')) {
    const [head, ...rest] = target.slice(1).split('.');
    if (head !== PROCESS_MACHINE.id) return null;
    const full = rest.join('.');
    return STATE_INDEX.has(full) ? full : null;
  }
  const parent = fromPath.includes('.') ? fromPath.slice(0, fromPath.lastIndexOf('.')) : '';
  const candidates = target.startsWith('.')
    ? [`${fromPath}.${target.slice(1)}`]
    : [parent ? `${parent}.${target}` : target, target];
  return candidates.find((c) => STATE_INDEX.has(c)) ?? null;
}

const asBranches = (value) => (Array.isArray(value) ? value : [value]);

/**
 * Take one event. Returns `{ value, actions, changed }` — the next fully
 * resolved state path, the action names the transition declared (the caller
 * performs them; this module never has side effects), and whether the state
 * path moved — or `null` when the event is not accepted in this state, so a
 * caller can reject "resume a process that is not paused" by name rather than
 * by silently doing nothing.
 *
 * Handlers are looked up on the state itself, then on each ancestor, which is
 * how XState's event bubbling works and is why STEP_FAILED declared on
 * `running` fires while the machine sits in `running.active`.
 */
export function transition(statePath, eventType, context = {}) {
  let cur = statePath;
  while (cur) {
    const entry = STATE_INDEX.get(cur);
    if (!entry) return null;
    const handler = entry.node.on?.[eventType];
    if (handler) {
      for (const branch of asBranches(handler)) {
        const guard = typeof branch === 'string' ? undefined : branch.guard;
        if (guard) {
          const predicate = PROCESS_GUARDS[guard];
          if (!predicate || !predicate(context)) continue;
        }
        const rawTarget = typeof branch === 'string' ? branch : branch.target;
        const actions = typeof branch === 'string' ? [] : [...(branch.actions || [])];
        if (rawTarget === undefined) return { value: statePath, actions, changed: false };
        const resolved = resolveTarget(rawTarget, cur);
        if (resolved === null) return null;
        return { value: resolveEntry(resolved), actions, changed: true };
      }
    }
    cur = entry.parent;
  }
  return null;
}

/** Every event accepted in `statePath` given `context` — what a UI enables
 * its Pause/Resume/Cancel/Retry buttons from, rather than reimplementing the
 * rules in the client. */
export function allowedEvents(statePath, context = {}) {
  return PROCESS_EVENTS.filter((e) => transition(statePath, e, context) !== null);
}

/** True once the process can never move again. */
export function isTerminal(statePath) {
  return TERMINAL_STATES.includes(topLevelState(statePath));
}

// ---------------------------------------------------------------------------
// Narration: reuse the blocks that already explain users' workflows.
// ---------------------------------------------------------------------------

/**
 * Render PROCESS_MACHINE into exactly the machine description
 * `workflowExtractor.mjs` produces from real source, so every block that
 * consumes an extracted machine consumes this one unchanged.
 */
export function describeProcessMachine() {
  const states = [];
  const transitions = [];

  const collect = (nodeStates, parentPath) => {
    for (const [name, node] of Object.entries(nodeStates || {})) {
      const path = parentPath ? `${parentPath}.${name}` : name;
      const type = node.type || (node.states ? 'compound' : 'atomic');
      const entry = {
        path,
        name,
        parent: parentPath || null,
        type,
        initial: false,
        entry: [],
        exit: [],
        invokes: [],
        final: type === 'final',
      };
      states.push(entry);
      if (node.states) {
        collect(node.states, path);
        const initialKid = states.find((s) => s.parent === path && s.name === node.initial);
        if (initialKid) initialKid.initial = true;
        entry.initialChild = initialKid ? initialKid.path : undefined;
      }
    }
  };
  collect(PROCESS_MACHINE.states, '');

  const topInitial = states.find((s) => !s.parent && s.name === PROCESS_MACHINE.initial);
  if (topInitial) topInitial.initial = true;

  for (const { path, node } of STATE_INDEX.values()) {
    for (const [event, handler] of Object.entries(node.on || {})) {
      for (const branch of asBranches(handler)) {
        const rawTarget = typeof branch === 'string' ? branch : branch.target;
        const resolved = rawTarget === undefined ? path : resolveTarget(rawTarget, path);
        transitions.push({
          from: path,
          event,
          kind: 'on',
          target: resolved,
          rawTarget,
          guard: typeof branch === 'string' ? undefined : branch.guard,
          actions: typeof branch === 'string' ? [] : [...(branch.actions || [])],
          editable: !Array.isArray(handler) && rawTarget !== undefined && !(typeof branch === 'object' && branch.guard),
          targetless: rawTarget === undefined,
          unresolved: rawTarget !== undefined && resolved === null,
        });
      }
    }
  }

  return {
    exportName: 'processMachine',
    id: PROCESS_MACHINE.id,
    initial: topInitial ? topInitial.path : null,
    states,
    transitions,
    context: Object.entries(PROCESS_MACHINE.context || {}).map(([name, value]) => ({ name, initial: JSON.stringify(value) })),
    contextEditable: true,
    hasSetup: false,
    declared: { actions: [], guards: Object.keys(PROCESS_GUARDS) },
    error: null,
  };
}

/** The process lifecycle in plain English, from the same narrator that
 * explains a user's own XState machines. Deterministic; no model involved. */
export function narrateProcessLifecycle() {
  return narrateMachine(describeProcessMachine());
}

/** Given/When/Then routes through the lifecycle, plus the structural health
 * findings the same block reports for any machine. Returns
 * `{ scenarios, loops, truncated, total, health }` — enumerateScenarios()'s
 * own result with the findings folded in. */
export function processLifecycleScenarios(options = {}) {
  const machine = describeProcessMachine();
  return { ...enumerateScenarios(machine, options), health: findHealthIssues(machine) };
}
