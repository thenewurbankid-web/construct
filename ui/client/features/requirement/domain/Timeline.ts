// Pure (DOMAIN-001): the placement read back in the order it runs. The same placement always gives the same steps, byte for byte:
// no model, no clock, no I/O. A changed answer changes the placement, so the timeline redraws from it.
//
// Run order is fixed by what each placement means: the page loads, the server fetches what must exist before anything is
// shown (server read), the screen is drawn from props (presentation), the person acts in the browser (interaction), the
// server changes data (mutation), and the person is sent on (redirect, only when the sentence asked for a validated one).
import type { Placement, PlacementBlock, PlacementKind, TimelineKind, TimelineStep } from './RequirementTypes.ts';

const TITLE: Record<TimelineKind, string> = {
  'page-load': 'Page load',
  'server-read': 'Server read',
  presentation: 'Presentation',
  interaction: 'Interaction',
  mutation: 'Mutation',
  redirect: 'Redirect',
};

/** The block kinds that own a step, in run order. */
const RUN_ORDER: { kind: TimelineKind; placement: PlacementKind }[] = [
  { kind: 'server-read', placement: 'server-read' },
  { kind: 'presentation', placement: 'presentational' },
  { kind: 'interaction', placement: 'client-leaf' },
  { kind: 'mutation', placement: 'mutation' },
];

/** What a named check means in a sentence about the step it guards. An unknown name is shown as it is. */
const CHECK_PHRASE: Record<string, string> = {
  'auth-session-check': 'the person is signed in',
  'server-only-secret': 'the secret stays on the server',
  'validated-redirect': 'the redirect goes only to an allow-listed address',
  'owner-only-access': 'only the owner can reach the data',
  'latency-budget': 'it answers within its time budget',
  'retry-and-error-state': 'a failure shows an error and a retry',
  'accessibility-check': 'it works by keyboard and screen reader',
};

const phrase = (name: string): string => CHECK_PHRASE[name] ?? name;
const owner = (b: PlacementBlock): string[] => b.layers.map((l) => `${l.layer} ${l.name}`);
const guard = (names: string[], lead: string): string => (names.length ? ` ${lead} ${names.map(phrase).join(' and ')}.` : '.');
/** The checks a step is guarded by: `validated-redirect` is a step of its own, not a guard of the mutation. */
const guards = (b: PlacementBlock): string[] => b.checkNames.filter((n) => n !== 'validated-redirect');

function lineFor(kind: TimelineKind, b: PlacementBlock | null, screen: string): string {
  switch (kind) {
    case 'page-load':
      return `The person opens the page "${screen}".`;
    case 'server-read':
      return `The server fetches "${b?.label}" before anything is shown${guard(guards(b as PlacementBlock), 'and first makes sure')}`;
    case 'presentation':
      return `"${b?.label}" is drawn from the data it is given, with no data access of its own.`;
    case 'interaction':
      return `In the browser, the person acts: "${b?.label}".`;
    case 'mutation':
      return `The server changes data for "${b?.label}"${guard(guards(b as PlacementBlock), 'and first makes sure')}`;
    default:
      return 'Then the person is sent on, and only to an allow-listed address.';
  }
}

/** The screen the units are wired into: the name of the first page or controller layer. */
export function screenOf(blocks: PlacementBlock[]): string {
  return blocks.flatMap((b) => b.layers).find((l) => l.layer === 'page' || l.layer === 'controller')?.name ?? 'the screen';
}

/**
 * The timeline of a placement: the page load, then one step per block in run order, then a redirect after each mutation
 * that carries `validated-redirect`. Empty when nothing is placed yet (a word of the card is still open).
 */
export function toTimeline(placement: Pick<Placement, 'blocks'> | null): TimelineStep[] {
  const blocks = placement?.blocks ?? [];
  if (blocks.length === 0) return [];
  const screen = screenOf(blocks);
  const steps: Omit<TimelineStep, 'order'>[] = [];
  const add = (kind: TimelineKind, b: PlacementBlock | null) =>
    steps.push({ kind, title: TITLE[kind], blockId: b?.id ?? null, owner: b ? owner(b) : [], checks: b ? (kind === 'redirect' ? ['validated-redirect'] : guards(b)) : [], line: lineFor(kind, b, screen) });
  add('page-load', null);
  for (const { kind, placement: from } of RUN_ORDER) for (const b of blocks.filter((x) => x.placement === from)) add(kind, b);
  for (const b of blocks.filter((x) => x.placement === 'mutation' && x.checkNames.includes('validated-redirect'))) add('redirect', b);
  return steps.map((s, i) => ({ ...s, order: i + 1 }));
}
