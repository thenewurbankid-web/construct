'use client';

import Link from 'next/link';
import type { FormEvent } from 'react';
import { CommandResult } from '@/components/CommandResult';
import { Button, Field, GlassPanel, Input, Select } from '@/components/ui';
import type { CommandResult as CommandResultType } from '../types';
import { LayerCheckboxes } from './LayerCheckboxes';

type UnitFieldsProps = {
  name: string;
  setName: (v: string) => void;
  feature: string;
  setFeature: (v: string) => void;
  layers: string[];
  toggleLayer: (l: string) => void;
  allLayers: readonly string[];
  from: string;
  setFrom: (v: string) => void;
};

function UnitFields({ name, setName, feature, setFeature, layers, toggleLayer, allLayers, from, setFrom }: UnitFieldsProps) {
  return (
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
  );
}

type LlmFieldsProps = { useLlm: boolean; setUseLlm: (v: boolean) => void };

function LlmFields({ useLlm, setUseLlm }: LlmFieldsProps) {
  return (
    <label className="checkbox">
      <Input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />
      Have the LLM write the ported logic (provider set in Settings; otherwise: TODO(import) breadcrumbs only)
    </label>
  );
}

type ImportFormProps = UnitFieldsProps &
  LlmFieldsProps & {
    mode: string;
    setMode: (v: string) => void;
    planPath: string;
    setPlanPath: (v: string) => void;
    visibility: { unit: boolean; plan: boolean };
    result: CommandResultType | null;
    busy: boolean;
    run: (e: FormEvent) => void;
  };

export function ImportForm(props: ImportFormProps) {
  const { mode, setMode, planPath, setPlanPath, visibility, result, busy, run } = props;
  return (
    <GlassPanel as="form" className="command-form" onSubmit={run}>
      <h3>Import an existing file</h3>
      <p className="hint">
        To bring in a whole route, use the <Link href="/wizard">Import Wizard</Link>.
      </p>
      <Field label="Mode">
        <Select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="unit">Single unit (one old file)</option>
          <option value="plan">From an approved plan file</option>
        </Select>
      </Field>
      {visibility.unit ? (
        <UnitFields {...props} />
      ) : (
        <Field label="Plan file path">
          <Input value={planPath} onChange={(e) => setPlanPath(e.target.value)} placeholder="./plan.json" required />
        </Field>
      )}
      <LlmFields {...props} />
      <Button type="submit" disabled={busy}>
        {busy ? 'Running…' : visibility.unit ? 'Import file' : 'Import plan'}
      </Button>
      <CommandResult result={result} />
    </GlassPanel>
  );
}
