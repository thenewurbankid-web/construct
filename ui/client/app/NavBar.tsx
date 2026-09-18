'use client';

// Shared chrome (the top nav), not a Construct feature — like layout.tsx
// itself, this lives directly under app/ rather than inside features/,
// since Construct's route-layer rules (ROUTE-001/002) only ever classify
// `app/**/page.tsx` files, not layout.tsx or its own helpers. Kept as a
// small standalone component here rather than inline in layout.tsx purely
// for readability.
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard', activeOn: ['/', '/dashboard'] },
  { href: '/wizard', label: 'Import Wizard', activeOn: ['/wizard'] },
  { href: '/pages', label: 'Pages Editor', activeOn: ['/pages'] },
  { href: '/ollama', label: 'Local Model', activeOn: ['/ollama'] },
  { href: '/settings', label: 'Settings', activeOn: ['/settings'] },
  { href: '/help', label: 'Help', activeOn: ['/help'] },
];

export function NavBar() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      <div className="nav-title">Construct</div>
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} className={link.activeOn.includes(pathname) ? 'active' : ''}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
