import type { FlowHint, FlowRow } from '../types.ts';

/** The hover explanation for a row: how it relates to the row that imports it (`page -> component`; when
 * the file belongs to another feature the features are named instead: `catalog -> auth`) and its path. */
export function hintFor(row: FlowRow, rows: FlowRow[]): FlowHint {
  const byId = new Map(rows.map((r) => [r.id, r]));
  let parent = row.parentId ? byId.get(row.parentId) : undefined;
  while (parent && parent.kind === 'branch') parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  if (row.kind === 'route') return { relation: 'route', sentence: `${row.label} is entered from the route file; the controllers below are what it renders.`, path: row.file };
  if (row.kind === 'branch') return { relation: row.label, sentence: `The files this controller reaches through its ${row.label.toLowerCase()}.`, path: null };
  if (!parent) return { relation: row.layer, sentence: `${row.label} is a ${row.layer}.`, path: row.file };
  const crosses = row.kind === 'node' && !!row.feature && !!parent.feature && row.feature !== parent.feature;
  const relation = crosses ? `${parent.feature} -> ${row.feature}` : `${parent.layer} -> ${row.layer}`;
  const also = row.shownAbove ? ' It is drawn in full above; here it is only a reference.' : '';
  const sentence = crosses ? `${parent.label} (${parent.feature}) uses ${row.label} from the ${row.feature} feature.${also}` : `${parent.label} imports ${row.label}.${also}`;
  return { relation, sentence, path: row.file };
}
