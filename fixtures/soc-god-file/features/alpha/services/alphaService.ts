export async function fetchAlpha() {
  const response = await fetch('/api/alpha');
  return response.json();
}
