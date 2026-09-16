// In-memory settings for the UI server: which LLM provider new import
// actions should use, and which Construct project directory every command
// targets. Deliberately not persisted to disk — this is a local dev tool;
// restarting the server resets to its defaults. `llmProvider` is validated
// against the *real* `PROVIDERS` map in src/llm.mjs (not a UI-side copy), so
// the settings screen's dropdown can never drift from what the core CLI
// actually supports.
import fs from 'node:fs';
import path from 'node:path';
import { PROVIDERS } from '../../../src/llm.mjs';

const state = {
  // Defaults to wherever the server process was started from. The settings
  // screen lets a user point this at any Construct project (or a
  // not-yet-`construct init`'ed directory) without restarting the server.
  projectDir: process.cwd(),
  llmProvider: Object.keys(PROVIDERS)[0] || null,
};

export function getSettings() {
  return {
    projectDir: state.projectDir,
    llmProvider: state.llmProvider,
    availableProviders: Object.keys(PROVIDERS),
  };
}

export function updateSettings({ projectDir, llmProvider } = {}) {
  if (llmProvider !== undefined && llmProvider !== null && llmProvider !== '') {
    if (!PROVIDERS[llmProvider]) {
      throw new Error(`Unknown LLM provider "${llmProvider}". Available: ${Object.keys(PROVIDERS).join(', ')}`);
    }
    state.llmProvider = llmProvider;
  }
  if (projectDir !== undefined && projectDir !== null && projectDir !== '') {
    const resolved = path.resolve(projectDir);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Not a directory: ${resolved}`);
    }
    state.projectDir = resolved;
  }
  return getSettings();
}
