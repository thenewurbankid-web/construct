export async function fetchUser() {
  const response = await fetch('/api/user', { method: 'GET' });
  if (!response.ok) throw new Error('Request failed');
  return response.json();
}
