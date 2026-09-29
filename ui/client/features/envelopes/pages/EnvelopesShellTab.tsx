import type { ShellTab } from '@/features/shell';
import { EnvelopesController } from '../controllers/EnvelopesController';

// Presentation-only: the Envelopes list as a shell tab (Browser). The Features screen registers it into the
// shell's slot registry while it is mounted, beside Notes, Blocks and Rules (#407's precedent); the tab's body
// reads flows only when open.
//
// `onOpenProcesses` is threaded in rather than read via `useShellDrawer()` inside this tab: the shell's
// `ShellDrawerContext.Provider` wraps only its stage `children` (see ShellFrame.tsx), not the Browser pane's
// registered tabs, so a Browser-pane tab reading that context directly gets the no-op default. Same shape
// `blocksShellTab(runBlock)` already uses for its own shell-level callback.
export function envelopesShellTab(onOpenProcesses: () => void): ShellTab {
  return { id: 'envelopes', title: 'Envelopes', render: () => <EnvelopesController onOpenProcesses={onOpenProcesses} /> };
}
