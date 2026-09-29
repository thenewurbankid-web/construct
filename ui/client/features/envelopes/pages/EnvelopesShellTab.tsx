import type { ShellTab } from '@/features/shell';
import { EnvelopesController } from '../controllers/EnvelopesController';

// Presentation-only: the Envelopes list as a shell tab (Browser). The Features screen registers it into the
// shell's slot registry while it is mounted, beside Notes, Blocks and Rules (#407's precedent); the tab's body
// reads flows only when open.
export function envelopesShellTab(): ShellTab {
  return { id: 'envelopes', title: 'Envelopes', render: () => <EnvelopesController /> };
}
