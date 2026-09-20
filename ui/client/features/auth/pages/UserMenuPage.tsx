import type { ReactNode } from 'react';
import { UserMenu } from '../components/UserMenu';
import type { AuthUser } from '../types';

type UserMenuPageProps = {
  visible: boolean;
  user: AuthUser | null;
  children?: ReactNode;
  label: string;
  initial: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSignOut: () => void;
};

// Presentation-only (PAGE-002..006): renders the account chip. On a server with
// no login gate it is the same menu without an account header (Settings, Theme and Help live in it).
export function UserMenuPage({ visible, user, label, initial, open, onToggle, onClose, onSignOut, children }: UserMenuPageProps): ReactNode {
  if (!visible) return null;
  return (
    <UserMenu user={user} label={label} initial={initial} open={open} onToggle={onToggle} onClose={onClose} onSignOut={onSignOut}>
      {children}
    </UserMenu>
  );
}
