'use client';

import type { FormEvent } from 'react';
import { CommandResult } from '@/components/CommandResult';
import { Button, Field, GlassPanel, Input, Select } from '@/components/ui';
import type { CommandResult as CommandResultType } from '../types';
import { LayerCheckboxes } from './LayerCheckboxes';

type ImportFormProps = {
  mode: string;
  setMode: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  feature: string;
  setFeature: (v: string) => void;
  layers: string[];
  toggleLayer: (l: string) => void;
  allLayers: readonly string[];
  from: string;
  setFrom: (v: string) => void;
  planPath: string;
  setPlanPath: (v: string) => void;
  useLlm: boolean;
  setUseLlm: (v: boolean) => void;
  llm: string;
  setLlm: (v: string) => void;
  visibility: { unit: boolean; plan: boolean };
  result: CommandResultType | null;
  busy: boolean;
  run: (e: FormEvent) => void;
};

export function ImportForm(props: ImportFormProps) {
  const { mode, setMode, name, setName, feature, setFeature, layers, toggleLayer, allLayers, from, setFrom, planPath, setPlanPath, useLlm, setUseLlm, llm, setLlm, visibility, result, busy, run } = props;
  return (
    <GlassPanel as="form" className="command-form" onSubmit={run}>
      <h3>Import (non-interactive)</h3>
      <p className="hint">
        For a single old file or an already-approved plan file. For the guided, chat-style
        whole-route wizard, use the <strong>Import Wizard</strong> page instead.
      </p>
      <Field label="Mode">
        <Select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="unit">Single unit (one old file)</option>
          <option value="plan">From an approved plan file</option>
        </Select>
      </Field>
      {visibility.unit ? (
        <>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Feature">
            <Input value={feature} onChange={(e) => setFeature(e.target.value)} required />
          </Field>
          <Field label="Layers">
            <LayerCheckboxes selected={layers} onToggle={toggleLayer} options={allLayers} />
          </Field>
          <Field label="From (path to the old source file)">
            <Input value={from} onChange={(e) => setFrom(e.target.value)} required />
          </Field>
        </>
      ) : (
        <Field label="Plan file path">
          <Input value={planPath} onChange={(e) => setPlanPath(e.target.value)} placeholder="./plan.json" required />
        </Field>
      )}
      <label className="checkbox">
        <Input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />
        Have the LLM write the ported logic (otherwise: TODO(import) breadcrumbs only)
      </label>
      {useLlm && (
        <Field label="Provider">
          <Input value={llm} onChange={(e) => setLlm(e.target.value)} />
        </Field>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? 'Running…' : 'Run import'}
      </Button>
      <CommandResult result={result} />
    </GlassPanel>
  );
}
