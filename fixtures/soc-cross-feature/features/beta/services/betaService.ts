export async function fetchBeta() {
  const response = await fetch('/api/beta');
  return response.json();
}
