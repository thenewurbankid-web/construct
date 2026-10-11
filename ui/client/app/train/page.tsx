import { LineTrainController } from '@/features/line-train/controllers/LineTrainController';

// Train Line (owner, 2026-10-11): one place where the owner and Claude train Line's drafter on the solid Line tools.
// It needs no open project: its worlds are imaginary projects and the Line sample, tried in scratch copies.
export default function Page() {
  return <LineTrainController />;
}
