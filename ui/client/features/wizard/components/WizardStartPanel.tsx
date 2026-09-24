import { Button, Field, GlassPanel, Input, Select } from '@/components/ui';

type WizardStartPanelProps = {
  seedRoute: string;
  setSeedRoute: (v: string) => void;
  planner: 'ai' | 'mechanical';
  setPlanner: (v: 'ai' | 'mechanical') => void;
  onStart: () => void;
};

export function WizardStartPanel({ seedRoute, setSeedRoute, planner, setPlanner, onStart }: WizardStartPanelProps) {
  return (
    <GlassPanel className="wizard-start">
      <Field label="Seed route (optional — a URL like /v2/home, or a route folder path)">
        <Input value={seedRoute} onChange={(e) => setSeedRoute(e.target.value)} placeholder="/v2/home" />
      </Field>
      <Field label="Plan with">
        <Select value={planner} onChange={(e) => setPlanner(e.target.value === 'mechanical' ? 'mechanical' : 'ai')} data-testid="wizard-planner">
          <option value="ai">AI (one model call proposes the plan)</option>
          <option value="mechanical">Mechanical (from the code itself, no model, instant)</option>
        </Select>
      </Field>
      <Button onClick={onStart}>Start wizard session</Button>
    </GlassPanel>
  );
}
