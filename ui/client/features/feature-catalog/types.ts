// Shapes of what the Features screen reads: the feature index (GET /api/features) and one feature's summary
// (GET /api/features/:name/summary, the same JSON as `construct summarize feature:<name>`). Only the parts the screen uses.

/** A row of the index; when the engine could not summarize the feature it carries `error` instead of `summary`. */
export type FeatureRow = { name: string; path: string; ref: string; summary?: string; health?: string; completeness?: number; error?: { code?: string; message?: string } };

/** Files outside `featuresRoot`: pre-existing app code the tree doesn't manage, no violations attributed (#791). */
export type LegacyFiles = { count: number; files?: string[] };

export type FeatureIndexResponse =
  | { ok: true; features: FeatureRow[]; featuresRoot?: string; legacy?: LegacyFiles }
  | { ok: false; error?: { message?: string } };

export type SummaryFile = { path: string; layer: string | null; loc: number; purpose: string; frozen?: boolean };

export type SummaryWorkflow = { file: string; machine: string; summary: string; states: number; findings: { severity: string; message: string }[]; error?: string };

/** One architecture-rule violation (`violationsFor`, `packages/engine/units/facts.mjs`); #803's per-layer dot groups these by which layer `file` belongs to. */
export type SummaryViolation = { rule: string; severity: string; file: string; line?: number; message: string };

export type FeatureSummaryResponse =
  | {
      ok: true;
      name: string;
      /** `<root>/<name>`, root is `features` unless `architecture.yml`'s `features.root` overrides it (#393). */
      path: string;
      summary: string;
      health: { status: string; findings: { severity: string; code: string; message: string }[] };
      sections: {
        layers?: { present: string[]; missing: string[] };
        files?: Record<string, SummaryFile[]>;
        contracts?: { routes?: { route: string; file: string }[] };
        workflows?: SummaryWorkflow[];
        dependencies?: { usedBy?: { name: string; files: number }[]; usesFeatures?: { name: string; files: number }[] };
        rules?: { counts?: { error: number; warning: number }; violations?: SummaryViolation[] };
        tests?: { count: number; files?: string[] };
      };
    }
  | { ok: false; error?: { message?: string } };

/** A file in a layer, with where clicking it leads (another screen) when that screen can open it.
 * `frozen` (#478): externally-authored, read-only to Construct -- still listed. */
export type FeatureFile = { path: string; purpose: string; loc: number; href: string | null; frozen?: boolean };

export type FeatureLayerView = { layer: string; files: FeatureFile[]; violations: SummaryViolation[] };

/** Everything the details panel shows for one feature. */
export type FeatureView = {
  name: string;
  root: string;
  summary: string;
  health: string;
  findings: string[];
  routes: { route: string; file: string }[];
  layers: FeatureLayerView[];
  missingLayers: string[];
  workflows: SummaryWorkflow[];
  tests: { count: number; files: string[] };
  rules: { error: number; warning: number };
  usedBy: string[];
  usesFeatures: string[];
};

export type FeatureListState = { status: 'loading' | 'error' | 'ready'; features: FeatureRow[]; error: string; featuresRoot?: string; legacy?: LegacyFiles };
