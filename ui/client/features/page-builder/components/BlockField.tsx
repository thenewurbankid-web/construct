'use client';

import { useNode } from '@craftjs/core';
import type { ReactNode } from 'react';

export type BlockFieldProps = {
  /** The block prop this field edits. */
  prop: string;
  label: string;
  kind?: 'text' | 'number' | 'select';
  /** The `<option>`s of a select. */
  children?: ReactNode;
};

/** One labelled control of the selected block's settings, written straight back to the block's prop. */
export function BlockField({ prop, label, kind = 'text', children }: BlockFieldProps) {
  const { value, actions } = useNode((node) => ({ value: String((node.data.props as Record<string, unknown>)[prop] ?? '') }));
  const id = `pb-field-${prop}`;
  const onChange = (next: string) =>
    actions.setProp((p: Record<string, unknown>) => {
      p[prop] = kind === 'number' ? Number(next) || 0 : next;
    });
  if (kind === 'select') {
    return (
      <label className="pb-field" htmlFor={id}>
        <span className="pb-field-label">{label}</span>
        <select id={id} className="pb-input" data-testid={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {children}
        </select>
      </label>
    );
  }
  return (
    <label className="pb-field" htmlFor={id}>
      <span className="pb-field-label">{label}</span>
      <input id={id} className="pb-input" data-testid={id} type={kind} min={0} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** A block's drag handle (connect + drag in one ref) and its class, outlined while it is selected. */
export function useBlockNode(base: string) {
  const { connectors, selected } = useNode((node) => ({ selected: node.events.selected }));
  const ref = (el: HTMLElement | null) => {
    if (el) connectors.connect(connectors.drag(el));
  };
  return { ref, className: selected ? `pb-node ${base} pb-node--selected` : `pb-node ${base}` };
}
