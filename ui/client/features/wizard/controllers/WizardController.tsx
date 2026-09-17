'use client';

import { ProjectGateController } from '@/features/project-gate';
import { useWizard } from '../hooks/useWizard';
import { WizardPage } from '../pages/WizardPage';

export function WizardController() {
  const wizard = useWizard();
  return (
    <ProjectGateController>
      <WizardPage {...wizard} />
    </ProjectGateController>
  );
}
