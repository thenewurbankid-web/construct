'use client';

import { useFlowBrowser } from '../hooks/useFlowBrowser';
import { FlowBrowserPage } from '../pages/FlowBrowserPage';

type FlowBrowserControllerProps = {
  /** The feature the Browser pane currently has selected. The flow is per feature. */
  feature: string;
  /** Ctrl/Cmd-click on a row: the host opens the file (with the shared navigation trail). */
  onOpenFile: (file: string) => void;
};

/** The Flow view of the Browser pane: routes as roots, controllers beneath, two branches under each. */
export function FlowBrowserController({ feature, onOpenFile }: FlowBrowserControllerProps) {
  const flow = useFlowBrowser(feature);
  return <FlowBrowserPage {...flow} feature={feature} onOpen={onOpenFile} />;
}
