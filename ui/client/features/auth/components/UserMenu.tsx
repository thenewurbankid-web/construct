'use client';

import { useRef, type ReactNode } from 'react';
import { useDismissable } from '@/lib/useDismissable';
import type { AuthUser } from '../types';

type UserMenuProps = {
  /** null on a server with no login gate: the menu still holds the preferences, without an account header. */
  user: AuthUser | null;
  label: string;
  initial: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSignOut: () => void;
  /** The preference rows another feature puts in the menu (Settings, Local model, Theme, Help; #368). */
  children?: ReactNode;
};

/**
 * The signed-in account in the top bar: avatar, and a small popover with
 * the login and Sign out. Presentation only (COMPONENT-*).
 *
 * Deliberately a **disclosure, not a menu**. `role="menu"` promises arrow-key
 * roving focus, Home/End and type-ahead, none of which two items justify
 * implementing — and it would also make the login line an invalid child,
 * since `role="menu"` only permits `menuitem`/`group`/`separator`. Promising
 * a keyboard contract and not honouring it is worse for a screen-reader user
 * than an honest `aria-haspopup="true"` + `aria-controls`.
 *
 * Dismissal is the shared useDismissable contract (docs/design/popovers.md): focus moves in
 * on open, Escape closes and returns focus to the trigger, an outside click closes without
 * stealing focus, Tab out closes, opening the project switcher closes it. There is
 * deliberately **no focus trap**: trapping is for modals.
 *
 * The avatar is a plain <img> rather than next/image on purpose —
 * `avatars.githubusercontent.com` would otherwise need adding to
 * next.config.ts's remote patterns, and an optimiser round trip for one
 * 22px picture buys nothing.
 */
export function UserMenu({ user, label, initial, open, onToggle, onClose, onSignOut, children }: UserMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  const surfaceRef = useRef<HTMLDivElement>(null);
  useDismissable({ open, onClose, triggerRef, surfaceRef, id: 'account-chip' });

  const name = user ? label : 'Account';
  return (
    <div className="sh-user" data-testid="user-menu">
      <button
        ref={triggerRef}
        type="button"
        className="sh-user-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="sh-user-menu"
        aria-label={user ? `Signed in as ${label}` : 'Account and preferences'}
        title={user ? `Signed in as ${label} (${user.login})` : 'Settings, local model, theme and help'}
        data-testid="user-menu-trigger"
        onClick={onToggle}
      >
        {user?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="sh-avatar" src={user.avatarUrl} alt="" width={22} height={22} />
        ) : (
          <span className="sh-avatar sh-avatar--initial" aria-hidden="true">
            {user ? initial : 'C'}
          </span>
        )}
        <span className="sh-user-name">{name}</span>
      </button>
      {open && (
        <div
          ref={surfaceRef}
          className="sh-popover sh-popover--disclosure sh-popover--end sh-popover--account"
          id="sh-user-menu"
          // Choosing a page closes the menu; a preference (the theme) leaves it open so the change can be seen.
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a')) onClose();
          }}
        >
          {user ? (
            <div className="sh-user-head">
              <p className="sh-user-login" data-testid="user-menu-login">
                {user.login}
              </p>
              <p className="sh-user-sub">Signed in with GitHub</p>
            </div>
          ) : (
            <div className="sh-user-head">
              <p className="sh-user-login">This computer</p>
              <p className="sh-user-sub">No sign-in on this server</p>
            </div>
          )}
          {children}
          {user && (
            <button type="button" className="sh-user-item sh-user-row" data-testid="sign-out" onClick={onSignOut}>
              <span>Sign out</span>
              <span className="sh-user-hint">Ends this session only</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
