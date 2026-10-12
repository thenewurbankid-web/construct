// The atoms' shared test kit: wraps an atom's machine so a test records every state it reaches, every event it sends
// and every transition it takes, then checks them against the atom's descriptor (atom.json):
//   - every declared state was reached and every declared event was sent;
//   - every declared transition was taken ("*" matches any state);
//   - every transition the machine actually took is declared (no undeclared behaviour).
// An event a state ignores (send returns the very same value) is recorded as ignored, not as a transition.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAtom } from './contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Where the atoms live. */
export const ATOMS_DIR = path.join(HERE, 'atoms');

/**
 * One atom's descriptor, read from atoms/<id>/atom.json and checked.
 * @param {string} id
 * @returns {import('./contract.mjs').AtomDescriptor}
 */
export function readDescriptor(id) {
  return assertAtom(JSON.parse(fs.readFileSync(path.join(ATOMS_DIR, id, 'atom.json'), 'utf8')));
}

/**
 * Whether the declared transition `t` matches a taken one.
 * @param {import('./contract.mjs').AtomTransition} t
 * @param {{from: string, event: string, to: string}} taken
 * @returns {boolean}
 */
const matches = (t, taken) => (t.from === '*' || t.from === taken.from) && t.event === taken.event && t.to === taken.to;

/**
 * A recording wrapper around an atom machine, and the coverage check over what it recorded.
 * @param {import('./contract.mjs').AtomMachine} machine
 * @param {import('./contract.mjs').AtomDescriptor} [descriptor] Defaults to atoms/<machine.id>/atom.json.
 * @returns {{init: (input?: any) => any, send: (state: any, event: {type: string}) => any, run: (state: any, events: {type: string}[]) => any, missing: () => {states: string[], events: string[], transitions: string[], undeclared: string[]}, assertComplete: () => void, descriptor: import('./contract.mjs').AtomDescriptor}}
 */
export function kitFor(machine, descriptor = readDescriptor(machine.id)) {
  const states = new Set();
  const events = new Set();
  /** @type {Map<string, {from: string, event: string, to: string}>} */
  const taken = new Map();
  const kit = {
    descriptor,
    init(input) {
      const s = machine.init(input);
      states.add(machine.stateOf(s));
      return s;
    },
    send(state, event) {
      const from = machine.stateOf(state);
      const next = machine.send(state, event);
      events.add(event.type);
      if (next === state) return next;
      const to = machine.stateOf(next);
      states.add(to);
      taken.set(`${from} --${event.type}--> ${to}`, { from, event: event.type, to });
      return next;
    },
    run(state, list) {
      return list.reduce((s, e) => kit.send(s, e), state);
    },
    missing() {
      const all = [...taken.values()];
      return {
        states: descriptor.states.filter((s) => !states.has(s)),
        events: descriptor.events.map((e) => e.type).filter((e) => !events.has(e)),
        transitions: descriptor.transitions.filter((t) => !all.some((x) => matches(t, x))).map((t) => `${t.from} --${t.event}--> ${t.to}`),
        undeclared: [...taken.entries()].filter(([, x]) => !descriptor.transitions.some((t) => matches(t, x))).map(([k]) => k),
      };
    },
    assertComplete() {
      const m = kit.missing();
      const parts = [
        m.states.length ? `states never reached: ${m.states.join(', ')}` : '',
        m.events.length ? `events never sent: ${m.events.join(', ')}` : '',
        m.transitions.length ? `transitions never taken: ${m.transitions.join('; ')}` : '',
        m.undeclared.length ? `transitions taken but not declared in atom.json: ${m.undeclared.join('; ')}` : '',
      ].filter(Boolean);
      if (parts.length) throw new Error(`The test kit of atom ${descriptor.id} is incomplete: ${parts.join('. ')}.`);
    },
  };
  return kit;
}
