import { Badge, GlassPanel } from '@/components/ui';

type PickerTag = { tag: string; label: string; approxSize: string; recommended?: boolean; installed: boolean };

type ModelPickerProps = {
  tags: PickerTag[];
  selectedModel: string | null;
  onSelect: (tag: string) => void;
};

// Presentation-only (Epic 6.3/#99) — the hook has already merged
// "installed" status onto each tag, so this component only ever reads props.
export function ModelPicker({ tags, selectedModel, onSelect }: ModelPickerProps) {
  return (
    <GlassPanel className="ollama-model-picker">
      <h2>Qwen Coder model</h2>
      <p className="hint">
        Choose which size to use for local execution (import/create&apos;s per-file fill). The smallest
        is marked <strong>Recommended</strong> for most local machines — larger sizes are slower but
        more capable.
      </p>
      <ul className="ollama-model-picker-list">
        {tags.map((t) => (
          <li key={t.tag}>
            <label className="ollama-model-picker-option">
              <input
                type="radio"
                name="qwen-model"
                value={t.tag}
                checked={selectedModel === t.tag}
                onChange={() => onSelect(t.tag)}
              />
              <span className="ollama-model-picker-name">{t.label}</span>
              <span className="hint">{t.approxSize}</span>
              {t.recommended && <Badge tone="tool">Recommended</Badge>}
              {t.installed && <Badge tone="llm">Installed</Badge>}
            </label>
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}
