export async function fetchSettings() {
  const response = await fetch('/api/settings', { method: 'GET' });
  if (!response.ok) throw new Error('Request failed');
  return response.json();
}
