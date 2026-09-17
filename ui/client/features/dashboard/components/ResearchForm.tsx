'use client';

import type { FormEvent } from 'react';
import { CommandResult } from '@/components/CommandResult';
import { Button, Field, GlassPanel, Input, Select } from '@/components/ui';
import type { CommandResult as CommandResultType } from '../types';

type ResearchFormProps = {
  action: string;
  setAction: (v: string) => void;
  feature: string;
  setFeature: (v: string) => void;
  format: string;
  setFormat: (v: string) => void;
  since: string;
  setSince: (v: string) => void;
  visibility: { summarize: boolean };
  result: CommandResultType | null;
  busy: boolean;
  run: (e: FormEvent) => void;
};

export function ResearchForm({ action, setAction, feature, setFeature, format, setFormat, since, setSince, visibility, result, busy, run }: ResearchFormProps) {
  return (
    <GlassPanel as="form" className="command-form" onSubmit={run}>
      <h3>Research</h3>
      <p className="hint">Read-only — never writes anything.</p>
      <Field label="Action">
        <Select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="doctor">Doctor (environment/tooling check)</option>
          <option value="summarize">Summarize a feature</option>
        </Select>
      </Field>
      {visibility.summarize && (
        <>
          <Field label="Feature (optional — omit for the whole project)">
            <Input value={feature} onChange={(e) => setFeature(e.target.value)} />
          </Field>
          <Field label="Format">
            <Select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="json">json</option>
              <option value="md">md</option>
              <option value="compact">compact</option>
              <option value="prose">prose</option>
            </Select>
          </Field>
          <Field label="Since (git ref, optional)">
            <Input value={since} onChange={(e) => setSince(e.target.value)} placeholder="e.g. main" />
          </Field>
        </>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? 'Running…' : 'Run research'}
      </Button>
      <CommandResult result={result} />
    </GlassPanel>
  );
}
