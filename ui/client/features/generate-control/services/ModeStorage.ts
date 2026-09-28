// The Mechanical/AI choice, remembered per-browser per action kind (docs/design/
// ia-five-screens.md section 8.6: "stored per user and per action kind ... default
// Mechanical, reset to Mechanical when the model is offline"). Same shape as
// ui/client/features/ollama/services/OllamaModelSelection.tsx — a per-viewer
// convenience, not round-tripped to ui/server.
import type { ActionKind, GenerateMode } from '../types.ts';

const STORAGE_KEY = 'construct.generateControl.modeByActionKind';

function readAll(): Record<string, GenerateMode> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function loadMode(actionKind: ActionKind): GenerateMode {
  return readAll()[actionKind] === 'ai' ? 'ai' : 'mechanical';
}

export function saveMode(actionKind: ActionKind, mode: GenerateMode): void {
  try {
    const all = readAll();
    all[actionKind] = mode;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Best-effort only — a private window or blocked site data just means the
    // choice won't persist across reloads, not a hard failure.
  }
}
