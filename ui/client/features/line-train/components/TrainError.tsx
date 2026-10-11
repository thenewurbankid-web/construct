/** The one sentence of the last refusal or failure, or nothing. */
export function TrainError({ sentence }: { sentence: string | null }) {
  if (!sentence) return null;
  return (
    <p className="ltr-error" role="alert" data-testid="train-error">
      {sentence}
    </p>
  );
}
