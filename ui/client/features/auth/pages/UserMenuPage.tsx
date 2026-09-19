import type { ReactNode } from 'react';
import { UserMenu } from '../components/UserMenu';
import type { AuthUser } from '../types';

type UserMenuPageProps = {
  visible: boolean;
  user: AuthUser | null;
  label: string;
  initial: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSignOut: () => void;
};

// Presentation-only (PAGE-002..006): renders the account chip, or nothing
// at all on a server with no login gate.
export function UserMenuPage({ visible, user, label, initial, open, onToggle, onClose, onSignOut }: UserMenuPageProps): ReactNode {
  if (!visible || !user) return null;
  return (
    <UserMenu user={user} label={label} initial={initial} open={open} onToggle={onToggle} onClose={onClose} onSignOut={onSignOut} />
  );
}
