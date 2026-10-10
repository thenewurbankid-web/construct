// The shared AI module: the one place allowed to call a model.
export async function decide(prompt) {
  const r = await fetch('http://localhost:11434/api/generate', { method: 'POST', body: JSON.stringify({ prompt }) });
  return r.json();
}
