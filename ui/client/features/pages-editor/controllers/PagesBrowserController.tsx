'use client';

import { useState } from 'react';
import { BrowserViewSwitch, FlowBrowserController, useBrowserView } from '@/features/flow-browser';
import { PagesBrowserTab } from '../components/PagesBrowserTab';
import { FlowFilePeekController } from './FlowFilePeekController';

type PagesBrowserControllerProps = Omit<Parameters<typeof PagesBrowserTab>[0], 'view' | 'switcher' | 'flow'>;

/** The Browser pane of the Pages editor: Files (the default) or Flow (#328), remembered per project. A
 * Ctrl/Cmd-click on a Flow row opens that file with the same reference trail the Navigate panel uses. */
export function PagesBrowserController(props: PagesBrowserControllerProps) {
  const { view, choose } = useBrowserView();
  const [opened, setOpened] = useState<string | null>(null);
  const flow = (
    <>
      <FlowBrowserController feature={props.feature} onOpenFile={setOpened} />
      {opened && props.feature && <FlowFilePeekController key={opened} feature={props.feature} file={opened} onClose={() => setOpened(null)} />}
    </>
  );
  return <PagesBrowserTab {...props} view={view} switcher={<BrowserViewSwitch view={view} onChange={choose} />} flow={flow} />;
}
