'use client';
import { ReportingPage } from '../pages/ReportingPage';
import { useReporting } from '../hooks/useReporting';

export function ReportingController() {
  const { start } = useReporting();
  return <ReportingPage total={0} onStart={start} />;
}
