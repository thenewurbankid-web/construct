// Pure (DOMAIN-001): the Plan's chat (two modes, lib/lineModes.ts). The Plan is the panel on Components and Pages, so
// its options join those screens' chats ("<screen>.plan.*") through withPlanOptions; PLAN_CHAT is the same provider on
// its own (screen "plan", no levels). Reading the plan answers in the chat; a decision (Approve, a fix, Try again, Leave
// as it is) is not answered here: the screen runs it through the plan (useLinePlan), exactly as the panel's buttons do.
import type { ChatOption } from '../../../lib/lineChat.ts';
import type { ChatAnswer, Place, ScreenChatProvider } from '../../../lib/lineModes.ts';
import type { PlanStepRow, StepChoice } from '../types.ts';

/** A decision the person made from the chat, for the screen to run (useLinePlan's approve / choose). */
export type PlanDecision = { kind: 'approve'; stepId: string } | { kind: 'choose'; stepId: string; choice: StepChoice };

const ENDS = /[.?!]$/;
const sentence = (text: string) => (ENDS.test(text.trim()) ? text.trim() : `${text.trim()}.`);
const stepKey = (n: number) => `step-${n}`;

/** The id word of a choice: retry, leave, and fix / fix-2 / ... in the order the panel shows the fixes. */
function choiceWords(choices: StepChoice[]): { word: string; choice: StepChoice }[] {
  let fixes = 0;
  return choices.map((choice) => {
    if (choice.id !== 'fix') return { word: choice.id, choice };
    fixes += 1;
    return { word: fixes === 1 ? 'fix' : `fix-${fixes}`, choice };
  });
}

function stepOptions(row: PlanStepRow): ChatOption[] {
  const key = stepKey(row.n);
  if (row.canApprove) return [{ id: `plan.approve.${key}`, label: `Approve step ${row.n}`, sentence: `Approve step ${row.n} and run it through the checked writer.`, effect: 'plan' }];
  return choiceWords(row.choices).map(({ word, choice }) => ({ id: `plan.${word}.${key}`, label: `${choice.label} (step ${row.n})`, sentence: sentence(choice.sentence), effect: 'plan' as const }));
}

const waitingCount = (rows: PlanStepRow[]) => rows.filter((r) => r.canApprove || r.choices.length > 0).length;

function summary(rows: PlanStepRow[]): string {
  if (!rows.length) return 'The plan has no steps yet.';
  const steps = rows.length === 1 ? 'one step' : `${rows.length} steps`;
  const wait = waitingCount(rows);
  const waits = wait === 0 ? 'none waits for you' : wait === 1 ? 'one waits for you' : `${wait} wait for you`;
  return `The plan has ${steps}, and ${waits}.`;
}

/** What is in the plan, oldest step first, each in its own sentence; the tool calls under Details. */
function stepsAnswer(rows: PlanStepRow[]): ChatAnswer {
  const oldest = [...rows].sort((a, b) => a.n - b.n);
  const lines = oldest.map((r) => `Step ${r.n}: ${sentence(r.sentence)}`);
  return { text: [summary(rows), ...lines].join(' '), details: oldest.map((r) => `Step ${r.n}: ${r.call}`) };
}

/** The Plan's provider. Its data is the Plan panel's rows (newest first, lib planRows). */
export const PLAN_CHAT: ScreenChatProvider<PlanStepRow[]> = {
  screen: 'plan',
  label: 'Plan',
  href: '/components',
  params: [],
  defaultMode: 'hood',
  options: (_place, rows) => [
    { id: 'plan.steps', label: 'What is in the plan?', sentence: 'Say every step of the plan and where it stands.', effect: 'read' },
    ...rows.flatMap(stepOptions),
  ],
  answer: (optionId, _place, rows) => (optionId === 'plan.steps' ? stepsAnswer(rows) : null),
  intro: (_place, rows) => ({ text: summary(rows) }),
};

/** The decision a Plan option id ("plan.<word>.step-<n>") names, or null (a read option, or a step that cannot take it). */
export function planDecision(optionId: string, rows: PlanStepRow[]): PlanDecision | null {
  const m = /^plan\.([a-z0-9-]+)\.step-(\d+)$/.exec(optionId);
  if (!m) return null;
  const row = rows.find((r) => r.n === Number(m[2]));
  if (!row) return null;
  if (m[1] === 'approve') return row.canApprove ? { kind: 'approve', stepId: row.id } : null;
  const hit = choiceWords(row.choices).find((c) => c.word === m[1]);
  return hit ? { kind: 'choose', stepId: row.id, choice: hit.choice } : null;
}

/** What a screen with the Plan joined reads: its own data and the Plan panel's rows. */
export type WithPlan<D> = { screen: D; plan: PlanStepRow[] };
