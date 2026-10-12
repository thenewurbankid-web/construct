import type { StepProfile } from '../types';

/** How the step decides or writes, in one plain sentence. */
export function howItWorks(p: StepProfile): string {
  if (p.provider === 'hosted') return 'A hosted model you choose in the settings above writes it; with none chosen, nothing runs.';
  const on = p.on ?? (p.ladder.options.on && Boolean(p.ladder.measured));
  if (p.kind === 'decide' && on) return 'Static checks first, then the picker (jev until Line-1 ships) picks among the checked options; if the local model is not running, the static answer stands.';
  if (p.kind === 'decide') return 'Off: static checks decide, and when they cannot, you are asked.';
  if (on) return 'The local model writes it and Construct keeps only what passes; if the model is not running, you decide.';
  if (p.onRequest) return 'Runs only when you ask; the local model writes it and checks keep only what passes.';
  return 'Off: the static path answers, and you fill in what it cannot.';
}

/** The model as a person reads it: "qwen2.5-coder:1.5b (Line's default)". */
export function modelText(p: StepProfile): string {
  if (p.model === null) return 'The hosted model you choose';
  return `${p.model} (${p.modelFrom})`;
}
