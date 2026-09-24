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
    label: 'Import: which model fills in files',
    hint: 'Writes the ported logic when you ask for it on an import; it can be a local model.',
  },
  {
    capability: 'createFill',
    label: 'Create: which model fills in files',
    hint: 'Writes the implementation when you ask for it on a create; it can be a local model.',
  },
  {
    capability: 'planAnalysis',
    label: 'Import wizard: which model reads the plan',
    hint: 'Always a hosted model; a local one is never offered.',
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
            Passed as <code>--dir</code> to every command (same as the CLI). Pick it from your projects;
            it doesn&apos;t need <code>architecture.yml</code> yet if you plan to run{' '}
            <code>init</code>-equivalent actions from here first.
          </>
        }
      >
        <Input
          type="text"
          value={projectDirInput}
          readOnly
          placeholder="Choose one of your projects below"
        />
      </Field>
      <Button type="button" variant="ghost" onClick={onTogglePicker} aria-expanded={pickerOpen}>
        {pickerOpen ? 'Close project list' : 'Choose a project…'}
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
