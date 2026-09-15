export async function Core() {
  const response = await fetch('/api/core', { method: 'GET' });
  if (!response.ok) throw new Error('Request failed');
  return response.json();
}
