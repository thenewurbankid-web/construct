'use client';

import type { UserComponent } from '@craftjs/core';
import type { ReactNode } from 'react';
import { BlockField, useBlockNode } from './BlockField';

export type ContainerProps = { direction?: 'row' | 'column'; gap?: number; padding?: number; children?: ReactNode };

function ContainerSettings() {
  return (
    <div className="pb-fields">
      <BlockField prop="direction" label="Direction" kind="select">
        <option value="column">column</option>
        <option value="row">row</option>
      </BlockField>
      <BlockField prop="gap" label="Gap (px)" kind="number" />
      <BlockField prop="padding" label="Padding (px)" kind="number" />
    </div>
  );
}

/** A flex box other blocks are dropped into (a Craft canvas). */
export const Container: UserComponent<ContainerProps> = ({ direction = 'column', gap = 8, padding = 16, children }) => {
  const { ref, className } = useBlockNode('pb-container');
  return (
    <div ref={ref} className={className} style={{ flexDirection: direction, gap, padding }} data-testid="pb-container">
      {children}
    </div>
  );
};

Container.craft = {
  displayName: 'Container',
  props: { direction: 'column', gap: 8, padding: 16 },
  related: { settings: ContainerSettings },
};
