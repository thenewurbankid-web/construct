'use client';

import { useHelp } from '../hooks/useHelp';
import { HelpPage } from '../pages/HelpPage';

// Help is reachable regardless of project status — no gate.
export function HelpController() {
  const view = useHelp();
  return <HelpPage {...view} />;
}
