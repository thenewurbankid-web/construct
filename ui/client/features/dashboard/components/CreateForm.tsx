'use client';

import type { FormEvent } from 'react';
import { CommandResult } from '@/components/CommandResult';
import { Button, Field, GlassPanel, Input, Select } from '@/components/ui';
import type { CommandResult as CommandResultType } from '../types';
import { LayerCheckboxes } from './LayerCheckboxes';

type CreateFormProps = {
  kind: string;
  setKind: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  feature: string;
  setFeature: (v: string) => void;
  layer: string;
  setLayer: (v: string) => void;
  layers: string[];
  toggleLayer: (l: string) => void;
  allLayers: readonly string[];
  visibility: { feature: boolean; layer: boolean; layers: boolean };
  result: CommandResultType | null;
  busy: boolean;
  run: (e: FormEvent) => void;
};

// Presentation-only (PAGE/COMPONENT rules): every field's value and change
// handler comes in as props from the dashboard feature's hook — no fetch,
// no workflow/service/domain import here.
export function CreateForm({ kind, setKind, name, setName, feature, setFeature, layer, setLayer, layers, toggleLayer, allLayers, visibility, result, busy, run }: CreateFormProps) {
  return (
    <GlassPanel as="form" className="command-form" onSubmit={run}>
      <h3>Create</h3>
      <Field label="What to scaffold">
        <Select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="feature">A new feature (all 7 layer folders)</option>
          <option value="layer">A vertical slice (several layers of one logical unit)</option>
          <option value="single">A single layer file</option>
        </Select>
      </Field>
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CpoAccess" required />
      </Field>
      {visibility.feature && (
        <Field label="Feature">
          <Input value={feature} onChange={(e) => setFeature(e.target.value)} placeholder="e.g. cpo-v2" required />
        </Field>
      )}
      {visibility.layer && (
        <Field label="Layer">
          <Select value={layer} onChange={(e) => setLayer(e.target.value)}>
            {allLayers.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </Select>
        </Field>
      )}
      {visibility.layers && (
        <Field label="Layers (built in dependency order regardless of the order checked)">
          <LayerCheckboxes selected={layers} onToggle={toggleLayer} options={allLayers} />
        </Field>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? 'Running…' : 'Run create'}
      </Button>
      <CommandResult result={result} />
    </GlassPanel>
  );
}
