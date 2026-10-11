'use client';

import { Field, Input } from '@/components/ui';

type LineProjectFieldsProps = {
  /** Shown only when the project starts as Line. */
  show: boolean;
  firstFeature: string;
  parentDir: string;
  featureProblem: string | null;
  parentProblem: string | null;
  disabled: boolean;
  onFirstFeature: (v: string) => void;
  onParentDir: (v: string) => void;
};

/** cu7: the extra fields of a Line project in the New project form: what it starts with, its first feature and the
 * workspace folder it goes in. Presentation only. */
export function LineProjectFields({ show, firstFeature, parentDir, featureProblem, parentProblem, disabled, onFirstFeature, onParentDir }: LineProjectFieldsProps) {
  if (!show) return null;
  return (
    <>
      <p className="hint" data-testid="new-project-line-intro">
        A Line project starts with a small library (a button, a text field, a card, a list page and a sample record) and one empty feature. Every change is checked, so it starts with no problems.
      </p>
      <div className="new-project__row">
        <Field label="First feature" hint={featureProblem ?? 'What the app does first, for example "catalog".'}>
          <Input
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="catalog"
            value={firstFeature}
            disabled={disabled}
            aria-invalid={featureProblem ? true : undefined}
            onChange={(e) => onFirstFeature(e.target.value)}
            data-testid="new-project-feature"
          />
        </Field>
        <Field label="Put it in" hint={parentProblem ?? 'A folder in your workspace. Leave empty for the workspace itself.'}>
          <Input
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="(your workspace)"
            value={parentDir}
            disabled={disabled}
            aria-invalid={parentProblem ? true : undefined}
            onChange={(e) => onParentDir(e.target.value)}
            data-testid="new-project-parent"
          />
        </Field>
      </div>
    </>
  );
}
