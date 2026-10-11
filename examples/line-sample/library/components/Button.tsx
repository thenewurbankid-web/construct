// @line-level atom
const look = { padding: '8px 16px', border: 0, borderRadius: 6, background: '#2563eb', color: '#ffffff', fontWeight: 600 };

export function Button({ label }: { label: string }) {
  return (
    <button type="button" style={look}>
      {label}
    </button>
  );
}
