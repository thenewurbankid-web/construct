import { useState } from 'react';
import type { Alert } from '../types';
import sample from '../fixtures/alerts.json';

export function useAlerts() {
  const [alerts] = useState<Alert[]>(sample as Alert[]);
  return alerts;
}
