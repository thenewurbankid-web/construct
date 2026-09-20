// Pure (DOMAIN-001): the same changed files the other way round: one group per layer, in reading order.
import type { ChangedFile, LayerView } from '../types.ts';
import { toLayers } from './FeatureGrouping.ts';

export function groupByLayer(files: ChangedFile[]): LayerView[] {
  return toLayers(files).map((l) => ({ layer: l.layer, label: l.label, fileCount: l.files.length, files: l.files }));
}
