// Two modes: what a breadcrumb crumb does, in order: the chat (and the URL) move to the crumb's place, then the mode
// becomes Under the hood, so the screen's view mounts at exactly that place with that item selected.
import { crumbTarget, type Crumb, type LineMode, type Place } from '@/lib/lineModes';

export function crumbToHood(crumb: Crumb, go: ((place: Place) => void) | undefined, setMode: (mode: LineMode) => void): void {
  const target = crumbTarget(crumb);
  go?.(target.place);
  setMode(target.mode);
}
