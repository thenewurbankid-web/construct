import { Element, Frame } from '@craftjs/core';
import { Container } from '../components/Container';
import { ExportPanel } from '../components/ExportPanel';
import { SettingsPanel } from '../components/SettingsPanel';
import { Toolbox } from '../components/Toolbox';
import { TopBar } from '../components/TopBar';
import type { PageBuilderPageProps } from '../types';

// Presentation-only: toolbox (left), the Craft canvas (centre), settings of the selected block (right), actions on top.
export function PageBuilderPage({ name, status, exported, onRename, onExport, onSave, onLoad, onCopy, onDownload, onCloseExport }: PageBuilderPageProps) {
  return (
    <div className="pb-stage" data-testid="pb-stage">
      <TopBar name={name} status={status} onRename={onRename} onExport={onExport} onSave={onSave} onLoad={onLoad} />
      <div className="pb-panes">
        <Toolbox />
        <main className="pb-canvas" data-testid="pb-canvas" aria-label="Canvas">
          <Frame>
            <Element is={Container} canvas direction="column" gap={12} padding={24} />
          </Frame>
        </main>
        <SettingsPanel />
      </div>
      <ExportPanel tsx={exported} onCopy={onCopy} onDownload={onDownload} onClose={onCloseExport} />
    </div>
  );
}
