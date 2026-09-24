import { Button } from '@/components/ui';

type ReviewBarProps = {
  reviewing: boolean;
  onReview: () => void;
};

/** Offered as soon as the wizard has written a file, and stays available at every later pause and after the run. */
export function ReviewBar({ reviewing, onReview }: ReviewBarProps) {
  return (
    <div className="review-bar">
      <Button type="button" onClick={onReview} disabled={reviewing}>
        {reviewing ? 'Reviewing…' : 'Review what was written'}
      </Button>
      <span className="hint">A model compares the plan and the source with the new files. It only reports; it never edits.</span>
    </div>
  );
}
