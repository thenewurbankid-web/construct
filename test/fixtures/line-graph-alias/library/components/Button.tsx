export function Button({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <button type="button" onClick={onPress}>
      {label}
    </button>
  );
}
