'use client';

import { useState, type ReactNode } from 'react';
import { Button, Field, Input, Select } from '@/components/ui';
import type { LlmCapability, LlmModels, LlmProviders, SaveStatus } from '../types';

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

// #471: same free-text pattern as the per-block model field (BlockCard.tsx) — an installed
// model's own name, not a chosen-from-a-list value, so there is exactly one place (the backend's
// MODEL_RE, shared from blockSettingsStore.mjs) that decides what a valid model name looks like.
// Local draft state so a keystroke doesn't fire a save; committed onBlur, matching BlockCard.
function ModelField({ capability, value, onChange }: { capability: LlmCapability; value: string | null; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value ?? '');
  return (
    <Input
      id={`llm-model-${capability}`}
      type="text"
      value={draft}
      placeholder="— the provider's own default —"
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== (value ?? '')) onChange(draft);
      }}
    />
  );
}

type SettingsFormProps = {
  projectDirInput: string;
  setProjectDirInput: (v: string) => void;
  llmProviders: LlmProviders;
  setLlmProvider: (capability: LlmCapability, value: string) => void;
  llmModels: LlmModels;
  setLlmModel: (capability: LlmCapability, value: string) => void;
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
  llmModels,
  setLlmModel,
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
          {llmProviders[capability] === 'ollama' && (
            <Field
              label={`${label}: which installed model`}
              hint="An installed Ollama model's own name (see the Local Model screen), or leave it blank to use that provider's built-in default."
            >
              <ModelField capability={capability} value={llmModels[capability]} onChange={(value) => setLlmModel(capability, value)} />
            </Field>
          )}
        </Field>
      ))}

      <Button onClick={onSave}>Save settings</Button>

      {status && <p className={status.ok ? 'status-ok' : 'status-error'}>{status.message}</p>}
    </>
  );
}
