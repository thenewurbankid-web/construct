'use client';

import { Element, useEditor } from '@craftjs/core';
import type { ReactElement } from 'react';
import { Button } from './Button';
import { Container } from './Container';
import { Heading } from './Heading';
import { Image } from './Image';
import { Text } from './Text';

type ToolProps = { id: string; label: string; create: ReactElement };

function Tool({ id, label, create }: ToolProps) {
  const { connectors } = useEditor();
  return (
    <button
      type="button"
      className="pb-tool"
      data-testid={`pb-tool-${id}`}
      ref={(el) => {
        if (el) connectors.create(el, create);
      }}
    >
      {label}
    </button>
  );
}

/** The blocks you can drag onto the canvas. */
export function Toolbox() {
  return (
    <aside className="pb-toolbox" aria-label="Blocks">
      <h2 className="pb-pane-title">Blocks</h2>
      <p className="pb-hint">Drag onto the canvas</p>
      <Tool id="container" label="Container" create={<Element is={Container} canvas />} />
      <Tool id="heading" label="Heading" create={<Heading />} />
      <Tool id="text" label="Text" create={<Text />} />
      <Tool id="button" label="Button" create={<Button />} />
      <Tool id="image" label="Image" create={<Image />} />
    </aside>
  );
}
