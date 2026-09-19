'use client';

import { useCallback, useState } from 'react';
import { showsAccount } from '../domain/Session';
import { displayName, initial } from '../domain/UserLabel';
import { useAuthSession } from './useAuthSession';

/** Everything the top bar's account chip needs: whether to show one at all,
 * how to label it, and the open/close + sign-out actions. Keeps
 * UserMenuController a pure wiring layer (CONTROLLER-001). */
export function useUserMenu() {
  const { session, signOut } = useAuthSession();
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const handleSignOut = useCallback(() => {
    setOpen(false);
    void signOut();
  }, [signOut]);

  const user = session?.user ?? null;
  return {
    visible: showsAccount(session),
    user,
    label: displayName(user),
    initial: initial(user),
    open,
    toggle,
    handleSignOut,
  };
}
