// Pure (DOMAIN-001): the words of the Notes screen, for the states of docs/design/mocks/ia-notes-states.html.
import type { NoteRow, NoteStatus, SaveState } from './NoteTypes.ts';

export const STATUS_LABEL: Record<NoteStatus, string> = { draft: 'Draft', 'plan-ready': 'Plan ready', ran: 'Ran' };

/** "12:41" from an ISO time; empty when it does not parse. */
export function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export type Indicator = { tone: 'idle' | 'busy' | 'ok' | 'warn' | 'bad'; text: string; icon: string };

/** The save indicator: Saving / Saved on this machine / Unsaved / Not saved / Changed in another tab. */
export function indicatorOf(save: SaveState, dirty: boolean, readOnly: boolean): Indicator {
  if (readOnly) return { tone: 'idle', text: 'Read-only history', icon: '' };
  switch (save.status) {
    case 'saving':
      return { tone: 'busy', text: 'Saving...', icon: '' };
    case 'conflict':
      return { tone: 'warn', text: 'This note changed in another tab', icon: '⚠' };
    case 'failed':
      return { tone: 'bad', text: `Not saved · ${failureReason(save.code, save.message)}`, icon: '✕' };
    case 'saved': {
      const at = clock(save.at);
      return dirty ? { tone: 'idle', text: 'Unsaved changes', icon: '' } : { tone: 'ok', text: at ? `Saved on this machine · ${at}` : 'Saved on this machine', icon: '✓' };
    }
    default:
      return dirty ? { tone: 'idle', text: 'Unsaved changes', icon: '' } : { tone: 'idle', text: 'Nothing to save', icon: '' };
  }
}

/** The short reason after "Not saved": the server's code in plain words, else its message. */
export function failureReason(code: string, message: string): string {
  switch (code) {
    case 'DISK_FULL':
      return 'disk full';
    case 'NOT_WRITABLE':
      return 'folder not writable';
    case 'TOO_LARGE':
      return 'note too large (256 KiB max)';
    case 'UNREACHABLE':
      return 'server not reachable';
    default:
      return message || 'unknown error';
  }
}

/** What Retry can do about it: the hint under the indicator. */
export function failureHint(code: string): string {
  if (code === 'TOO_LARGE') return 'Shorten the note, then press Retry. Your text stays in the page.';
  if (code === 'DISK_FULL') return 'Free some space and press Retry. Your text stays in the page; do not close the tab yet.';
  return 'Your text stays in the page. Press Retry; do not close the tab yet.';
}

export function rowTitle(row: NoteRow): string {
  return row.title.trim() || 'Untitled note';
}

/** The tag beside a row or the editor title: "Draft", "Plan ready", "Plan out of date", "Ran". */
export function statusTag(status: NoteStatus, planStale: boolean): { label: string; tone: 'draft' | 'ready' | 'stale' | 'run' } {
  if (status === 'ran') return { label: STATUS_LABEL.ran, tone: 'run' };
  if (planStale) return { label: 'Plan out of date', tone: 'stale' };
  return status === 'plan-ready' ? { label: STATUS_LABEL['plan-ready'], tone: 'ready' } : { label: STATUS_LABEL.draft, tone: 'draft' };
}
