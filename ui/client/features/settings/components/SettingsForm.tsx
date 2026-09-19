'use client';

import type { ReactNode } from 'react';
import { Button, Field, Input, Select } from '@/components/ui';
import type { LlmCapability, LlmProviders, SaveStatus } from '../types';

type CapabilityRow = { capability: LlmCapability; label: string; hint: string };

// One row per independently-configurable LLM capability (#100/Epic 6.4).
// `planAnalysis` intentionally has no local-model option in its own
// dropdown — ui/server/src/settings.mjs's `availableProvidersByCapability`
// already excludes it from that capability's list, so this never even
// renders an 'ollama' <option> for planAnalysis, let alone lets it be
// chosen; the hint spells out why so it isn't read as an arbitrary
// omission.
const CAPABILITY_ROWS: CapabilityRow[] = [
  {
    capability: 'importFill',
    label: 'Import: per-file fill',
    hint: 'Used when you tick “Have the LLM write the ported logic” on the Dashboard Import form, and for the per-file fill of the Import Wizard (only if you approve it there). Never used unless you opt in per run. Selects the provider only — models use their defaults (Ollama: qwen2.5-coder:7b). May be a local model.',
  },
  {
    capability: 'createFill',
    label: 'Create/generate: per-file fill',
    hint: 'Used only when you tick “Have the LLM write the implementation” on the Dashboard Create form (layer / vertical slice). Off by default per run. Selects the provider only — models use their defaults. May be a local model.',
  },
  {
    capability: 'planAnalysis',
    label: 'Import route wizard: plan analysis',
    hint: 'The one whole-feature analysis call the Import Wizard makes (that wizard always calls it). Deliberately never offered as a local model — always a hosted model.',
  },
];

type SettingsFormProps = {
  projectDirInput: string;
  setProjectDirInput: (v: string) => void;
  llmProviders: LlmProviders;
  setLlmProvider: (capability: LlmCapability, value: string) => void;
  availableProviders: string[];
  availableProvidersByCapability: Record<LlmCapability, string[]>;
  status: SaveStatus | null;
  onSave: () => void;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  /** Folder-picker element supplied by the controller (another feature). */
  picker?: ReactNode;
};

export function SettingsForm({
  projectDirInput,
  setProjectDirInput,
  llmProviders,
  setLlmProvider,
  availableProvidersByCapability,
  status,
  onSave,
  pickerOpen,
  onTogglePicker,
  picker,
}: SettingsFormProps) {
  return (
    <>
      <Field
        label="Project directory"
        hint={
          <>
            Passed as <code>--dir</code> to every command (same as the CLI). Must be an existing
            directory; it doesn&apos;t need <code>architecture.yml</code> yet if you plan to run{' '}
            <code>init</code>-equivalent actions from here first.
          </>
        }
      >
        <Input
          type="text"
          value={projectDirInput}
          onChange={(e) => setProjectDirInput(e.target.value)}
          placeholder="/path/to/your/construct-project"
        />
      </Field>
      <Button type="button" variant="ghost" onClick={onTogglePicker} aria-expanded={pickerOpen}>
        {pickerOpen ? 'Close folder browser' : 'Browse folders…'}
      </Button>
      {pickerOpen && picker}

      {CAPABILITY_ROWS.map(({ capability, label, hint }) => (
        <Field key={capability} label={label} hint={hint}>
          <Select
            id={`llm-${capability}`}
            value={llmProviders[capability] ?? ''}
            onChange={(e) => setLlmProvider(capability, e.target.value)}
          >
            <option value="">— none (this step stays off unless a command opts in) —</option>
            {(availableProvidersByCapability[capability] ?? []).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </Select>
        </Field>
      ))}

      <Button onClick={onSave}>Save settings</Button>

      {status && <p className={status.ok ? 'status-ok' : 'status-error'}>{status.message}</p>}
    </>
  );
}
