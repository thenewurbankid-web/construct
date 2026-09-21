import { Logo } from '@/components/ui';
import type { GateTopBarProps } from '../types';

/** The minimal top bar shown while no project is open: the brand and the profile menu (Settings, Local model,
 * theme, Help, Sign out) and nothing that needs a project. */
export function GateTopBar({ userMenu }: GateTopBarProps) {
  return (
    <header className="sh-top" role="banner">
      <span className="sh-brand">
        <Logo mark="cockpit" size={22} />
        <span>Cockpit</span>
      </span>
      <span className="sh-spacer" />
      {userMenu}
    </header>
  );
}
