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
  const close = useCallback(() => setOpen(false), []);
  const handleSignOut = useCallback(() => {
    setOpen(false);
    void signOut();
  }, [signOut]);

  const user = session?.user ?? null;
  return {
    // The menu is always there once the session is known: it also holds Settings, Theme and Help (#368).
    visible: session !== null,
    user: showsAccount(session) ? user : null,
    label: displayName(user),
    initial: initial(user),
    open,
    toggle,
    close,
    handleSignOut,
  };
}
