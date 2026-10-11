import Link from 'next/link';
import './line-features.css';

/** For a project that is not a Line project yet: one sentence and the way into Import (/import), so an owner finds it
 * without typing an address (UAT, 11 Oct). */
export function ImportOffer() {
  return (
    <p className="lf-import-offer" data-testid="lf-import-offer">
      This project is not a Line project yet. <Link href="/import">Bring one folder of it into Line</Link>
    </p>
  );
}
