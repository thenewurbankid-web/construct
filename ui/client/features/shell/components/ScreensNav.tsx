import Link from 'next/link';
import type { ScreensNavProps } from '../types';

/** The Browser pane's "Screens" tab: every existing screen (the old sidebar nav). */
export function ScreensNav({ screens, pathname }: ScreensNavProps) {
  return (
    <nav aria-label="Screens" className="sh-screens">
      {screens.map((screen) => {
        const active = screen.activeOn.includes(pathname);
        return (
          <Link
            key={screen.href}
            href={screen.href}
            className={active ? 'sh-screen sh-screen--active' : 'sh-screen'}
            aria-current={active ? 'page' : undefined}
          >
            {screen.label}
          </Link>
        );
      })}
    </nav>
  );
}
