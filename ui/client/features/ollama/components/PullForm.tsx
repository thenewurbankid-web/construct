import { Button, Field, GlassPanel, Input } from '@/components/ui';

type PullFormProps = {
  pullName: string;
  setPullName: (v: string) => void;
  pulling: boolean;
  pullStatus: string | null;
  pullPercent: number | null;
  pullError: string | null;
  onPull: () => void;
  recommended?: { tag: string; label: string }[];
};

// Presentation-only. `recommended` (Epic 6.3/#99) renders as a datalist so
// the field stays a plain text input (any Ollama-library tag still works)
// while surfacing the vetted Qwen Coder tags as suggestions.
export function PullForm({ pullName, setPullName, pulling, pullStatus, pullPercent, pullError, onPull, recommended }: PullFormProps) {
  return (
    <GlassPanel as="form" className="ollama-pull" onSubmit={(e) => { e.preventDefault(); onPull(); }}>
      <h2>Pull a model</h2>
      <Field
        label="Model tag"
        hint={
          recommended && recommended.length > 0
            ? 'Pick a recommended Qwen Coder size below, or type any Ollama-library tag.'
            : 'e.g. qwen2.5-coder:0.5b — any Ollama-library tag works.'
        }
      >

        <Input
          list="ollama-recommended-models"
          type="text"
          value={pullName}
          onChange={(e) => setPullName(e.target.value)}
          placeholder="qwen2.5-coder:0.5b"
        />
        {recommended && (
          <datalist id="ollama-recommended-models">
            {recommended.map((r) => (
              <option key={r.tag} value={r.tag}>{r.label}</option>
            ))}
          </datalist>
        )}
      </Field>
      <Button type="submit" disabled={pulling || !pullName.trim()}>
        {pulling ? 'Pulling…' : 'Pull'}
      </Button>
      {pulling && (
        <p className="ollama-pull-progress" data-testid="ollama-pull-progress">
          {pullStatus || 'Starting…'}
          {pullPercent !== null && ` (${pullPercent}%)`}
        </p>
      )}
      {pullError && <p className="status-error">{pullError}</p>}
    </GlassPanel>
  );
}
