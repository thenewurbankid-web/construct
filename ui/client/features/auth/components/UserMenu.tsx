'use client';

import { useRef } from 'react';
import { useDismissable } from '@/lib/useDismissable';
import type { AuthUser } from '../types';

type UserMenuProps = {
  user: AuthUser;
  label: string;
  initial: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSignOut: () => void;
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
export function UserMenu({ user, label, initial, open, onToggle, onClose, onSignOut }: UserMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  const surfaceRef = useRef<HTMLDivElement>(null);
  useDismissable({ open, onClose, triggerRef, surfaceRef, id: 'account-chip' });

  return (
    <div className="sh-user" data-testid="user-menu">
      <button
        ref={triggerRef}
        type="button"
        className="sh-user-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="sh-user-menu"
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
        <div ref={surfaceRef} className="sh-popover sh-popover--disclosure sh-popover--end" id="sh-user-menu">
          <p className="sh-user-login" data-testid="user-menu-login">
            {user.login}
          </p>
          <button type="button" className="sh-user-item" data-testid="sign-out" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
