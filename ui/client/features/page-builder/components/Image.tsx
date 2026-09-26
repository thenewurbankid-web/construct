'use client';

import type { UserComponent } from '@craftjs/core';
import { BlockField, useBlockNode } from './BlockField';

export type ImageProps = { src?: string; alt?: string };

function ImageSettings() {
  return (
    <div className="pb-fields">
      <BlockField prop="src" label="Source URL" />
      <BlockField prop="alt" label="Alt text" />
    </div>
  );
}

/** An image by URL, with its alt text. */
export const Image: UserComponent<ImageProps> = ({ src = '/login/slide-1.webp', alt = 'Image' }) => {
  const { ref, className } = useBlockNode('pb-image');
  return <img ref={ref} className={className} src={src} alt={alt} data-testid="pb-image" />;
};

Image.craft = {
  displayName: 'Image',
  props: { src: '/login/slide-1.webp', alt: 'Image' },
  related: { settings: ImageSettings },
};
