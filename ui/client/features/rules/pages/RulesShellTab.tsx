import type { ShellTab } from '@/features/shell';
import { RulesController } from '../controllers/RulesController';

// Presentation-only: the Rules list as a shell tab (Browser). The Features screen registers it into the shell's slot
// registry while it is mounted, beside Notes and Blocks (#407's precedent); the tab's body reads rules only when open.
export function rulesShellTab(): ShellTab {
  return { id: 'rules', title: 'Rules', render: () => <RulesController /> };
}
