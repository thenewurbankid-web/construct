export async function fetchDashboard() {
  const response = await fetch('/api/dashboard', { method: 'GET' });
  if (!response.ok) throw new Error('Request failed');
  return response.json();
}
