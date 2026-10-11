// A stand-in for @mx/reason with the same contract: answers without a model.
export async function decide(prompt) {
  return { response: `mock answer to ${prompt}` };
}
