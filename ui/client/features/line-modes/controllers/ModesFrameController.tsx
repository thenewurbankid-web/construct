'use client';

import type { ComponentProps } from 'react';
import { ModesFrame } from '../components/ModesFrame';
import { useChatHidden } from '../hooks/useChatHidden';

export type ModesFrameControllerProps = Omit<ComponentProps<typeof ModesFrame>, 'hidden' | 'onToggleHidden'>;

/** The two-modes frame with the person's hide-the-chat choice wired in: for a screen that keeps its own chat (Features
 * keeps cd1's) and only needs the frame, the breadcrumb and the helper. */
export function ModesFrameController(props: ModesFrameControllerProps) {
  const [hidden, toggle] = useChatHidden();
  return <ModesFrame {...props} hidden={hidden} onToggleHidden={toggle} />;
}
