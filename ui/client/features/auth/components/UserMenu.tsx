'use client';

import { useRef, type KeyboardEvent } from 'react';
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
 * Escape closes it and returns focus to the trigger (the same idiom
 * ProjectSwitcher uses). There is deliberately **no focus trap**: trapping is
 * for modals, and this popover does not block the page. Outside-click
 * dismissal is missing here exactly as it is on the project switcher — that
 * is a missing shared primitive rather than this component's omission, and
 * it is tracked as its own design ticket.
 *
 * The avatar is a plain <img> rather than next/image on purpose —
 * `avatars.githubusercontent.com` would otherwise need adding to
 * next.config.ts's remote patterns, and an optimiser round trip for one
 * 22px picture buys nothing.
 */
export function UserMenu({ user, label, initial, open, onToggle, onClose, onSignOut }: UserMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      onClose();
      triggerRef.current?.focus();
    }
  };

  return (
    <div className="sh-user" data-testid="user-menu" onKeyDown={onKeyDown}>
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
        <div className="sh-user-menu" id="sh-user-menu">
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
