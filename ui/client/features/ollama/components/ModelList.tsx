import { Button, GlassPanel } from '@/components/ui';
import { EmptyState } from '@/features/states';

type ModelListProps = {
  models: Array<{ name: string; sizeLabel: string; modified_at?: string }>;
  onRemove: (name: string) => void;
};

// Presentation-only — the hook has already resolved `sizeLabel` so this
// never imports domain formatting itself.
export function ModelList({ models, onRemove }: ModelListProps) {
  return (
    <GlassPanel className="ollama-models">
      <h2>Installed models</h2>
      {models.length === 0 ? (
        <EmptyState size="inline" title="No models pulled yet" hint="Pick a recommended model below and pull it to run small steps locally." />
      ) : (
        <table className="ollama-model-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Size</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.name}>
                <td>{m.name}</td>
                <td>{m.sizeLabel}</td>
                <td>
                  <Button variant="ghost" onClick={() => onRemove(m.name)}>
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </GlassPanel>
  );
}
