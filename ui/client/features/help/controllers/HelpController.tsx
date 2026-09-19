'use client';

import { useMemo } from 'react';
import { useRegisterShellTab, type ShellTab } from '@/features/shell';
import { HelpToc } from '../components/HelpToc';
import { HELP_TOPICS } from '../domain/HelpTopics';
import { useHelp } from '../hooks/useHelp';
import { HelpPage } from '../pages/HelpPage';

// Help is reachable regardless of project status — no gate. Its contents
// also appear as a tab in the shell's Browser pane (a slot the shell offers
// to every feature), next to the in-page contents nav.
export function HelpController() {
  const view = useHelp();
  const tab = useMemo<ShellTab>(
    () => ({ id: 'help-contents', title: 'Contents', render: () => <HelpToc topics={HELP_TOPICS} /> }),
    [],
  );
  useRegisterShellTab('browser', tab);
  return <HelpPage {...view} topics={HELP_TOPICS} />;
}
