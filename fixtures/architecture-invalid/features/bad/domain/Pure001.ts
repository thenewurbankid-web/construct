export function stamp(label: string) {
  return { label, at: Date.now() };
}
