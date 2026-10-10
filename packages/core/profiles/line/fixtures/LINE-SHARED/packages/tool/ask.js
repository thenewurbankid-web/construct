import Anthropic from '@anthropic-ai/sdk';

export const client = new Anthropic();
export async function ask(prompt) {
  return fetch(`http://127.0.0.1:11434/api/chat`, { method: 'POST', body: prompt });
}
