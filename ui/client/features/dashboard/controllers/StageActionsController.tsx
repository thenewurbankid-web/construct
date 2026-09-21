'use client';

import { useCallback, useState } from 'react';
import { OfflineState } from '@/features/states';
import { useModelStatus } from '@/features/shell';
import { StageActions } from '../components/StageActions';
import { STAGE_ACTIONS, nextOpenAction } from '../domain/StageActions';
import type { StageActionId } from '../types';
import { useDashboard } from '../hooks/useDashboard';

/**
 * The Features stage's Create / Refactor / Research / Import actions (#370). The route composes it into the
 * Features screen (`/`); it carries no project gate of its own because the screen it sits in already has one.
 */
export function StageActionsController() {
  const dashboard = useDashboard();
  const model = useModelStatus();
  const [open, setOpen] = useState<StageActionId | null>(null);
  const toggle = useCallback((id: StageActionId) => setOpen((cur) => nextOpenAction(cur, id)), []);
  return <StageActions {...dashboard} actions={STAGE_ACTIONS} open={open} onToggle={toggle} notice={model === 'offline' ? <OfflineState size="inline" /> : null} />;
}
