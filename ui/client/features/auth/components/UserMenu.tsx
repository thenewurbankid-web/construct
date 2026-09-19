'use client';

import type { AuthUser } from '../types';

type UserMenuProps = {
  user: AuthUser;
  label: string;
  initial: string;
  open: boolean;
  onToggle: () => void;
  onSignOut: () => void;
};

/**
 * The signed-in account in the top bar: avatar, and a small menu with the
 * login and Sign out. Presentation only (COMPONENT-*).
 *
 * The avatar is a plain <img> rather than next/image on purpose —
 * `avatars.githubusercontent.com` would otherwise need adding to
 * next.config.ts's remote patterns, and an optimiser round trip for one
 * 24px picture buys nothing.
 */
export function UserMenu({ user, label, initial, open, onToggle, onSignOut }: UserMenuProps) {
  return (
    <div className="sh-user" data-testid="user-menu">
      <button
        type="button"
        className="sh-user-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Signed in as ${label}`}
        title={`Signed in as ${label} (${user.login})`}
        data-testid="user-menu-trigger"
        onClick={onToggle}
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="sh-avatar" src={user.avatarUrl} alt="" width={22} height={22} />
        ) : (
          <span className="sh-avatar sh-avatar--initial" aria-hidden="true">
            {initial}
          </span>
        )}
        <span className="sh-user-name">{label}</span>
      </button>
      {open && (
        <div className="sh-user-menu" role="menu">
          <p className="sh-user-login" data-testid="user-menu-login">
            {user.login}
          </p>
          <button type="button" role="menuitem" className="sh-user-item" data-testid="sign-out" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
