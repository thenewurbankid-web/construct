'use client';

import type { UserComponent } from '@craftjs/core';
import { BlockField, useBlockNode } from './BlockField';

export type TextProps = { text?: string };

function TextSettings() {
  return (
    <div className="pb-fields">
      <BlockField prop="text" label="Text" />
    </div>
  );
}

/** A paragraph of text. */
export const Text: UserComponent<TextProps> = ({ text = 'Some text' }) => {
  const { ref, className } = useBlockNode('pb-text');
  return (
    <p ref={ref} className={className} data-testid="pb-text">
      {text}
    </p>
  );
};

Text.craft = {
  displayName: 'Text',
  props: { text: 'Some text' },
  related: { settings: TextSettings },
};
