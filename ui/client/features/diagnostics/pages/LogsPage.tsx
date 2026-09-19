import { LogsList } from '../components/LogsList';
import type { LogsViewProps } from '../types';

// Presentation-only: all state comes from the controller.
export function LogsPage(props: LogsViewProps) {
  return <LogsList {...props} />;
}
