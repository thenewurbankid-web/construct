'use client';

import type { UserComponent } from '@craftjs/core';
import { BlockField, useBlockNode } from './BlockField';

export type ButtonProps = { label?: string; variant?: 'primary' | 'secondary' };

function ButtonSettings() {
  return (
    <div className="pb-fields">
      <BlockField prop="label" label="Label" />
      <BlockField prop="variant" label="Variant" kind="select">
        <option value="primary">primary</option>
        <option value="secondary">secondary</option>
      </BlockField>
    </div>
  );
}

/** A button; its label names the handler the export gives it (`Add category` -> `onAddCategory`). */
export const Button: UserComponent<ButtonProps> = ({ label = 'Button', variant = 'primary' }) => {
  const { ref, className } = useBlockNode(`pb-button pb-button--${variant}`);
  return (
    <button ref={ref} type="button" className={className} data-testid="pb-button">
      {label}
    </button>
  );
};

Button.craft = {
  displayName: 'Button',
  props: { label: 'Button', variant: 'primary' },
  related: { settings: ButtonSettings },
};
