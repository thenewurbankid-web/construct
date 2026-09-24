'use client';

import { Button, Field, Input, Select } from '@/components/ui';
import { FRAMEWORK_CHOICES } from '../domain/NewProjectName';
import type { NewProjectFramework } from '../types';

type NewProjectFormProps = {
  name: string;
  framework: NewProjectFramework;
  /** A plain problem with the name typed so far, or null. */
  nameProblem: string | null;
  /** Where the folder will be made (`<workspace>/<name>`), or null while no name is typed. */
  destination: string | null;
  canCreate: boolean;
  creating: boolean;
  error: string | null;
  onName: (v: string) => void;
  onFramework: (v: NewProjectFramework) => void;
  onCreate: () => void;
};

/** Presentation-only "New project" form for the Open-a-project screen (#445): one name, an optional starting
 * framework, the button. Making the folder, setting it up and opening it is the server's job. */
export function NewProjectForm({ name, framework, nameProblem, destination, canCreate, creating, error, onName, onFramework, onCreate }: NewProjectFormProps) {
  return (
    <section className="new-project" aria-labelledby="new-project-heading" data-testid="new-project">
      <h2 id="new-project-heading" className="new-project__heading">New project</h2>
      <p className="hint">Start from nothing: give it a name and Construct makes an empty folder in your workspace, sets it up and opens it. No terminal needed.</p>
      <form
        className="new-project__form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canCreate) onCreate();
        }}
      >
        <div className="new-project__row">
          <Field label="Project name" hint={nameProblem ?? 'Letters, digits, "-" and "_".'}>
            <Input
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="my-app"
              value={name}
              disabled={creating}
              aria-invalid={nameProblem ? true : undefined}
              onChange={(e) => onName(e.target.value)}
              data-testid="new-project-name"
            />
          </Field>
          <Field label="Starts as">
            <Select value={framework} disabled={creating} onChange={(e) => onFramework(e.target.value as NewProjectFramework)} data-testid="new-project-framework">
              {FRAMEWORK_CHOICES.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </Select>
          </Field>
        </div>
        {destination && !nameProblem && (
          <p className="hint new-project__dest" role="status" aria-live="polite" data-testid="new-project-preview">
            Will be made at <code>{destination}</code>
          </p>
        )}
        <div className="new-project__actions">
          <Button type="submit" disabled={!canCreate} data-testid="new-project-create">
            {creating ? 'Creating…' : 'Create and open'}
          </Button>
        </div>
      </form>
      {error && (
        <p className="status-error" role="alert" data-testid="new-project-error">
          {error}
        </p>
      )}
    </section>
  );
}
