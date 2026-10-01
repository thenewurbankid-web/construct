import { sanitizePreviewSize } from '../domain/PreviewSize.ts';
import type { PreviewSizeId } from '../domain/PreviewSize.ts';

/** Storage key for one project's preview size (`null` = project not known yet). */
const key = (projectDir: string | null): string => `construct.pages.previewSize:${projectDir ?? '(default)'}`;

/** Reads one project's remembered preview size; guarded (storage can throw or hold garbage). */
export function loadPreviewSize(projectDir: string | null): PreviewSizeId {
  try {
    return sanitizePreviewSize(window.localStorage.getItem(key(projectDir)));
  } catch {
    return 'fit';
  }
}

export function savePreviewSize(projectDir: string | null, size: PreviewSizeId): void {
  try {
    window.localStorage.setItem(key(projectDir), size);
  } catch {
    /* remembering the choice is a convenience, not required */
  }
}
