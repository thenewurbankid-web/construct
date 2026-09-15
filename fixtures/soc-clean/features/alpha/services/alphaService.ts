export async function fetchAlpha() {
  const response = await fetch('/api/alpha', { method: 'GET' });
  if (!response.ok) throw new Error('Request failed');
  return response.json();
}
