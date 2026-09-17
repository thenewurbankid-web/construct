'use client';

import type { FormEvent } from 'react';
import { CommandResult } from '@/components/CommandResult';
import { Button, Field, GlassPanel, Input, Select } from '@/components/ui';
import type { CommandResult as CommandResultType } from '../types';

type RefactorFormProps = {
  action: string;
  setAction: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  newName: string;
  setNewName: (v: string) => void;
  feature: string;
  setFeature: (v: string) => void;
  from: string;
  setFrom: (v: string) => void;
  to: string;
  setTo: (v: string) => void;
  layer: string;
  setLayer: (v: string) => void;
  allLayers: readonly string[];
  visibility: { move: boolean; rename: boolean };
  result: CommandResultType | null;
  busy: boolean;
  run: (e: FormEvent) => void;
};

function LayerSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: readonly string[] }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((l) => (
        <option key={l} value={l}>{l}</option>
      ))}
    </Select>
  );
}

export function RefactorForm(props: RefactorFormProps) {
  const { action, setAction, name, setName, newName, setNewName, feature, setFeature, from, setFrom, to, setTo, layer, setLayer, allLayers, visibility, result, busy, run } = props;
  return (
    <GlassPanel as="form" className="command-form" onSubmit={run}>
      <h3>Refactor</h3>
      <p className="hint">Mechanical, LLM-free moves/renames — content and exported identifiers are never touched.</p>
      <Field label="Action">
        <Select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="move">Move (change layer)</option>
          <option value="rename">Rename (same layer)</option>
        </Select>
      </Field>
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      {visibility.rename && (
        <Field label="New name">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} required />
        </Field>
      )}
      <Field label="Feature">
        <Input value={feature} onChange={(e) => setFeature(e.target.value)} required />
      </Field>
      {visibility.move ? (
        <>
          <Field label="From layer"><LayerSelect value={from} onChange={setFrom} options={allLayers} /></Field>
          <Field label="To layer"><LayerSelect value={to} onChange={setTo} options={allLayers} /></Field>
        </>
      ) : (
        <Field label="Layer"><LayerSelect value={layer} onChange={setLayer} options={allLayers} /></Field>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? 'Running…' : 'Run refactor'}
      </Button>
      <CommandResult result={result} />
    </GlassPanel>
  );
}
