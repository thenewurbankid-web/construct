'use client';

import { useUserMenu } from '../hooks/useUserMenu';
import { UserMenuPage } from '../pages/UserMenuPage';

/**
 * The signed-in account in the top bar. Mounted by the shell as a slot, so
 * the shell knows a node goes there without knowing this feature exists.
 */
export function UserMenuController() {
  const { visible, user, label, initial, open, toggle, handleSignOut } = useUserMenu();
  return (
    <UserMenuPage
      visible={visible}
      user={user}
      label={label}
      initial={initial}
      open={open}
      onToggle={toggle}
      onSignOut={handleSignOut}
    />
  );
}
