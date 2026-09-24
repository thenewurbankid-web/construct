// Durable Notes over ui/server's /api/notes (#596). Every rule (the 256 KiB cap, the rev, what a plan may hold, what
// "ran" means) is the server's; this only asks and reports. A stale write (409) and a failed one are different
// answers on purpose: the first is routine and offers a choice, the second keeps your text and offers Retry.
import { sendJson } from '@/lib/http';
import type { ApiResult, Draft, Note, NoteRow, NoteStatus, SaveResult } from '../domain/NoteTypes';

type Failure = { ok?: false; code?: string; error?: string; current?: Note };
const UNREACHABLE = 'The Cockpit server could not be reached.';

const failed = (body: Failure | undefined, fallback: string): { ok: false; error: string; code: string } => ({ ok: false, error: body?.error ?? fallback, code: body?.code ?? 'FAILED' });

export async function listNotes(): Promise<ApiResult<NoteRow[]>> {
  try {
    const { status, body } = await sendJson<{ ok?: true; notes?: NoteRow[] } & Failure>('GET', '/api/notes');
    if (status === 200 && body.ok && body.notes) return { ok: true, data: body.notes };
    return failed(body, 'The notes could not be listed.');
  } catch {
    return { ok: false, error: UNREACHABLE, code: 'UNREACHABLE' };
  }
}

export async function fetchNote(id: string): Promise<ApiResult<Note>> {
  try {
    const { status, body } = await sendJson<{ ok?: true; note?: Note } & Failure>('GET', `/api/notes/${encodeURIComponent(id)}`);
    if (status === 200 && body.ok && body.note) return { ok: true, data: body.note };
    return failed(body, 'That note could not be opened.');
  } catch {
    return { ok: false, error: UNREACHABLE, code: 'UNREACHABLE' };
  }
}

export async function createNote(draft: Partial<Draft> = {}): Promise<ApiResult<Note>> {
  try {
    const { status, body } = await sendJson<{ ok?: true; note?: Note } & Failure>('POST', '/api/notes', draft);
    if (status === 201 && body.ok && body.note) return { ok: true, data: body.note };
    return failed(body, 'The note could not be created.');
  } catch {
    return { ok: false, error: UNREACHABLE, code: 'UNREACHABLE' };
  }
}

/** Save against `rev` (sent as If-Match). 409 STALE_REV hands back the copy that won. `extra` carries a plan and its
 * status when the caller (the Plan screen, #609) saves one along with the text; the server marks the plan out of date
 * when text is saved without one. */
export async function saveNote(id: string, rev: number, draft: Draft, extra: { plan?: unknown; status?: NoteStatus } = {}): Promise<SaveResult> {
  try {
    const { status, body } = await sendJson<{ ok?: true; note?: Note } & Failure>('PUT', `/api/notes/${encodeURIComponent(id)}`, { ...draft, ...extra }, { 'If-Match': String(rev) });
    if (status === 200 && body.ok && body.note) return { kind: 'ok', note: body.note };
    if (status === 409 && body.current && body.code === 'STALE_REV') return { kind: 'conflict', current: body.current };
    return { kind: 'failed', message: body.error ?? 'The note could not be saved.', code: body.code ?? 'FAILED' };
  } catch {
    return { kind: 'failed', message: UNREACHABLE, code: 'UNREACHABLE' };
  }
}

export async function duplicateNote(id: string): Promise<ApiResult<Note>> {
  try {
    const { status, body } = await sendJson<{ ok?: true; note?: Note } & Failure>('POST', `/api/notes/${encodeURIComponent(id)}/duplicate`, {});
    if (status === 201 && body.ok && body.note) return { ok: true, data: body.note };
    return failed(body, 'The note could not be duplicated.');
  } catch {
    return { ok: false, error: UNREACHABLE, code: 'UNREACHABLE' };
  }
}

export async function removeNote(id: string): Promise<ApiResult<string>> {
  try {
    const { status, body } = await sendJson<{ ok?: true } & Failure>('DELETE', `/api/notes/${encodeURIComponent(id)}`);
    // Already gone counts as deleted: the list should not keep a note that no longer exists.
    if ((status === 200 && body.ok) || status === 404) return { ok: true, data: id };
    return failed(body, 'The note could not be deleted.');
  } catch {
    return { ok: false, error: UNREACHABLE, code: 'UNREACHABLE' };
  }
}
