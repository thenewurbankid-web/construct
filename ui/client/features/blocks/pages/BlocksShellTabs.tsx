import type { ShellTab } from '@/features/shell';
import { BlocksController } from '../controllers/BlocksController';
import type { BlockRunRequest } from '../domain/BlockTypes';

// Presentation-only: the Blocks list as a shell tab (Browser). The Features screen registers it into the shell's slot
// registry while it is mounted; the tab's body reads the catalogue only when the tab is opened.
export function blocksShellTab(onRunBlock?: (request: BlockRunRequest) => void): ShellTab {
  return { id: 'blocks', title: 'Blocks', render: () => <BlocksController onRunBlock={onRunBlock} /> };
}
