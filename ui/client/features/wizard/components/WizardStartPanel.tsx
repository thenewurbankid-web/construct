import { Button, Field, GlassPanel, Input } from '@/components/ui';

type WizardStartPanelProps = {
  seedRoute: string;
  setSeedRoute: (v: string) => void;
  onStart: () => void;
};

export function WizardStartPanel({ seedRoute, setSeedRoute, onStart }: WizardStartPanelProps) {
  return (
    <GlassPanel className="wizard-start">
      <Field label="Seed route (optional — a URL like /v2/home, or a route folder path)">
        <Input value={seedRoute} onChange={(e) => setSeedRoute(e.target.value)} placeholder="/v2/home" />
      </Field>
      <Button onClick={onStart}>Start wizard session</Button>
    </GlassPanel>
  );
}
