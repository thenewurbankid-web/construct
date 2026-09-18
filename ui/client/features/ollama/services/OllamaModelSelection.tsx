// This feature's chosen "active" local model, persisted per-browser via
// localStorage — a per-viewer convenience, not shared state, so it lives
// here rather than round-tripping to ui/server. Epic 6.4 (#100, in
// progress on a separate branch) will add a per-capability provider
// setting on the backend; once that lands, this selection should feed
// into that instead of/alongside localStorage — see the #99 issue comment
// for that noted dependency.
const STORAGE_KEY = 'construct.ollama.selectedModel';

export function loadSelectedModel(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveSelectedModel(tag: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, tag);
  } catch {
    // Best-effort only — a private window or blocked site data just means
    // the selection won't persist across reloads, not a hard failure.
  }
}
