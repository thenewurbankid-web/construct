'use client';

import type { UserComponent } from '@craftjs/core';
import { BlockField, useBlockNode } from './BlockField';

export type HeadingProps = { text?: string; level?: string };

const TAGS: Record<string, 'h1' | 'h2' | 'h3'> = { '1': 'h1', '2': 'h2', '3': 'h3' };

function HeadingSettings() {
  return (
    <div className="pb-fields">
      <BlockField prop="text" label="Text" />
      <BlockField prop="level" label="Level" kind="select">
        <option value="1">1</option>
        <option value="2">2</option>
        <option value="3">3</option>
      </BlockField>
    </div>
  );
}

/** A heading, level 1 to 3. */
export const Heading: UserComponent<HeadingProps> = ({ text = 'Heading', level = '2' }) => {
  const { ref, className } = useBlockNode('pb-heading');
  const Tag = TAGS[String(level)] ?? 'h2';
  return (
    <Tag ref={ref} className={className} data-testid="pb-heading">
      {text}
    </Tag>
  );
};

Heading.craft = {
  displayName: 'Heading',
  props: { text: 'Heading', level: '2' },
  related: { settings: HeadingSettings },
};
