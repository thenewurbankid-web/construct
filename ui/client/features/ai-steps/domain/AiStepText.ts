import type { StepProfile } from '../types';

/** How the step decides or writes, in one plain sentence. */
export function howItWorks(p: StepProfile): string {
  if (p.provider === 'hosted') return 'A hosted model you choose in the settings above writes it; with none chosen, nothing runs.';
  if (p.kind === 'decide' && p.ladder.options.on) return 'Static checks first, then Qwen suggests and jev decides; if the local model is not running, the static answer stands.';
  if (p.kind === 'decide') return 'Static checks first, then Qwen picks with a cited fact; if the local model is not running, you are asked.';
  return 'Qwen writes it and static checks keep only what passes; if the local model is not running, nothing is written.';
}

/** The model as a person reads it: "qwen2.5-coder:1.5b (Line's default)". */
export function modelText(p: StepProfile): string {
  if (p.model === null) return 'The hosted model you choose';
  return `${p.model} (${p.modelFrom})`;
}
