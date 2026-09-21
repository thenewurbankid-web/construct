// Pure (DOMAIN-001): what the Components screen lists and what it says about one component.
import type { ComponentEntry, DescribeResponse, DocView } from '../types.ts';

/** A list row: the file's name, and where it lives ("billing · features/billing/components/BillingView.tsx"). */
export function toListItems(entries: ComponentEntry[]): { id: string; label: string; detail: string }[] {
  return entries.map((c) => ({ id: c.path, label: c.name, detail: c.feature ? `${c.feature} · ${c.path}` : c.path }));
}

/** The entry for a path only when it is in the list (a stale or hand-edited ?component= selects nothing). */
export function findComponent(entries: ComponentEntry[], path: string | null): ComponentEntry | null {
  return path === null ? null : (entries.find((c) => c.path === path) ?? null);
}

/** Props table, "no docs" note or a reader failure: the three things the doc panel can say. */
export function docView(response: DescribeResponse | null): DocView | null {
  if (response === null) return null;
  if (!response.ok) {
    if (response.code === 'DISABLED') return { kind: 'none', note: 'Prop documentation is switched off for this project.' };
    if (response.code === 'PARSE_ERROR' || response.code === 'TOO_LARGE' || response.code === 'TIMEOUT') return { kind: 'none', note: 'No prop documentation found.' };
    return { kind: 'failed', note: response.error ?? 'The props could not be read.' };
  }
  const withProps = response.components.filter((c) => c.props.length > 0 || c.description);
  if (withProps.length === 0) return { kind: 'none', note: 'No prop documentation found.' };
  return { kind: 'props', components: response.components };
}

/** Why no props are shown, when the reader gave a specific reason (a syntax error, a huge file): one plain sentence, or null. */
export function docReason(response: DescribeResponse | null): string | null {
  if (response === null || response.ok) return null;
  return response.code === 'DISABLED' ? null : (response.error ?? null);
}
