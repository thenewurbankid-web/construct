'use client';

import { Input } from '@/components/ui';

type LayerCheckboxesProps = {
  selected: string[];
  onToggle: (layer: string) => void;
  options: readonly string[];
};

/** Presentation-only — shared between CreateForm's "layer" kind and
 * ImportForm, exactly as it was before this migration (one component,
 * two call sites) rather than duplicated. `options` is handed down from
 * the hook (via the page) instead of being imported from the domain layer
 * directly — components may not import domain (COMPONENT-003). */
export function LayerCheckboxes({ selected, onToggle, options }: LayerCheckboxesProps) {
  return (
    <div className="layer-checkboxes">
      {options.map((layer) => (
        <label key={layer} className="checkbox">
          <Input type="checkbox" checked={selected.includes(layer)} onChange={() => onToggle(layer)} />
          {layer}
        </label>
      ))}
    </div>
  );
}
