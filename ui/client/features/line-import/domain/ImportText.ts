// Pure (DOMAIN-001): the Import screen's words for kinds and the scan.
import type { ImportFound, ImportScan } from '../types.ts';

const KIND_WORD: Record<string, string> = { components: 'Component', pages: 'Page', workflows: 'Workflow', fixtures: 'Fixture' };

/** "Component", "Page", ... for a kind folder name. */
export function kindWord(kind: string): string {
  return KIND_WORD[kind] ?? kind;
}

/** One line saying how many items and questions the scan has. */
export function scanSummary(scan: ImportScan): string {
  const n = scan.found.length;
  const q = scan.questions.length;
  if (!n) return `Line found nothing in ${scan.folder} to bring in.`;
  const items = `Line found ${n} item${n === 1 ? '' : 's'} in ${scan.folder}`;
  if (!q) return `${items} and can decide every one by itself.`;
  return `${items}; it needs your answer to ${q === 1 ? 'one question' : `${q} questions`}.`;
}

/** True when a found item is waiting on a question. */
export function asks(item: ImportFound): boolean {
  return item.confidence === 'ask';
}
