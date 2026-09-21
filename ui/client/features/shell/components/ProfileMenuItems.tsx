import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ProfileMenuItemsProps, ThemePreference } from '../types';

const THEME_CHOICES: { value: ThemePreference; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

const MODEL_LABEL = { checking: 'Checking', ready: 'Ready', offline: 'Offline' } as const;

/** The preference rows of the profile menu (#368): Settings, Local model with its status, the Theme choice
 * and Help. Rendered inside the account disclosure, which owns dismissal. Presentation only (COMPONENT-*).
 * The Theme control is a native radio group, so arrow keys, the group name and the checked state are the
 * browser's own. */
export function ProfileMenuItems({ pathname, modelStatus, preference, onPreference }: ProfileMenuItemsProps) {
  const link = (href: string, label: string, hint: ReactNode, testId: string) => (
    <Link href={href} className="sh-user-item sh-user-row" data-testid={testId} aria-current={pathname === href ? 'page' : undefined}>
      <span>{label}</span>
      {hint}
    </Link>
  );
  return (
    <>
      <p className="sh-user-section">Preferences</p>
      {link('/settings', 'Settings', <span className="sh-user-hint">Project folder, model choice</span>, 'profile-settings')}
      {link(
        '/ollama',
        'Local model',
        <span className={`sh-user-chip sh-user-chip--${modelStatus}`} data-testid="profile-model-status">
          <span className="sh-dot" aria-hidden="true" />
          {MODEL_LABEL[modelStatus]}
        </span>,
        'profile-local-model',
      )}
      <fieldset className="sh-user-theme" data-testid="profile-theme">
        <legend>Theme</legend>
        <div className="sh-seg">
          {THEME_CHOICES.map((c) => (
            <label key={c.value} className={preference === c.value ? 'sh-seg-opt sh-seg-opt--on' : 'sh-seg-opt'}>
              <input
                type="radio"
                name="profile-theme"
                value={c.value}
                checked={preference === c.value}
                onChange={() => onPreference(c.value)}
                data-testid={`theme-${c.value}`}
              />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {link('/help', 'Help and shortcuts', <span className="sh-user-hint">Tutorials and keys</span>, 'profile-help')}
    </>
  );
}
