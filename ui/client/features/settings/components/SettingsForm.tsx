'use client';

import { Button, Field, Input, Select } from '@/components/ui';
import type { SaveStatus } from '../types';

type SettingsFormProps = {
  projectDirInput: string;
  setProjectDirInput: (v: string) => void;
  llmProvider: string;
  setLlmProvider: (v: string) => void;
  availableProviders: string[];
  status: SaveStatus | null;
  onSave: () => void;
};

// Presentation-only — identical markup/classes to the original Settings.jsx
// form section so ui/e2e's settings.spec locates it unchanged.
export function SettingsForm({ projectDirInput, setProjectDirInput, llmProvider, setLlmProvider, availableProviders, status, onSave }: SettingsFormProps) {
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

      <Field
        label="LLM provider"
        hint={
          <>
            Construct only ever calls an LLM for import&apos;s optional fill step and the route
            wizard&apos;s analysis step — everything else (create, refactor, research, and import&apos;s
            scaffolding) stays fully deterministic regardless of this setting.
          </>
        }
      >
        <Select value={llmProvider} onChange={(e) => setLlmProvider(e.target.value)}>
          <option value="">— none (LLM steps stay off unless a command opts in) —</option>
          {availableProviders.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </Select>
      </Field>

      <Button onClick={onSave}>Save settings</Button>

      {status && <p className={status.ok ? 'status-ok' : 'status-error'}>{status.message}</p>}
    </>
  );
}
