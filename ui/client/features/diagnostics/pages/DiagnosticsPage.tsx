import { DiagnosticsList } from '../components/DiagnosticsList';
import type { DiagnosticsViewProps } from '../types';

// Presentation-only: all state comes from the controller.
export function DiagnosticsPage(props: DiagnosticsViewProps) {
  return <DiagnosticsList {...props} />;
}
