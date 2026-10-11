'use client';

import { useState } from 'react';
import type { RouteField } from '../types';

type Props = { tools: { name: string; label: string }[]; fieldsFor: (tool: string) => RouteField[]; addRoute: (tool: string, values: Record<string, string>) => void };

const option = (o: { value: string; label: string }) => <option key={o.value} value={o.value}>{o.label}</option>;

/** A route the drafter missed, added with closed choices: pick the tool, pick each value from the project's lists. */
export function AddRouteForm({ tools, fieldsFor, addRoute }: Props) {
  const [tool, setTool] = useState('line.baseOn');
  const [values, setValues] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setValues((x) => ({ ...x, [k]: v }));
  const tool_ = (t: { name: string; label: string }) => <option key={t.name} value={t.name}>{t.label}</option>;
  const field = (f: RouteField) => (
    <label key={`${tool}-${f.key}`} className="ltr-field">
      {f.label}
      <FieldInput f={f} value={values[f.key]} set={set} />
    </label>
  );
  return (
    <details className="ltr-tech" data-testid="train-add-route">
      <summary>Add a route the drafter missed</summary>
      <form className="ltr-fields" onSubmit={(e) => { e.preventDefault(); addRoute(tool, values); setValues({}); }} aria-label="Add a route">
        <label className="ltr-field">
          Tool
          <select className="ltr-select" value={tool} onChange={(e) => { setTool(e.target.value); setValues({}); }}>
            {tools.map(tool_)}
          </select>
        </label>
        {fieldsFor(tool).map(field)}
        <button type="submit" className="ltr-btn">Add route</button>
      </form>
    </details>
  );
}

/** A pick from the project's list, or a typed value. */
function FieldInput({ f, value, set }: { f: RouteField; value?: string; set: (k: string, v: string) => void }) {
  if (f.kind === 'pick') {
    return (
      <select className="ltr-select" value={value ?? f.options[0]?.value ?? ''} onChange={(e) => set(f.key, e.target.value)}>
        {f.options.map(option)}
      </select>
    );
  }
  return <input className="ltr-input" value={value ?? ''} onChange={(e) => set(f.key, e.target.value)} />;
}
