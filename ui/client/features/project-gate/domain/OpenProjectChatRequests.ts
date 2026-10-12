// Pure (DOMAIN-001): the request an option chip or an answer to the helper's question stands for. It then goes through
// the same static reading as typed text (OpenProjectRequest.ts).

const OPTION_REQUESTS: Record<string, string> = {
  'open.new': 'start a new project',
  'open.github': 'bring in from GitHub',
  'open.list': 'show my projects',
  'open.line': 'what is a Line project?',
};

/** The request an option chip stands for ('' for an unknown chip). */
export function requestForOption(optionId: string): string {
  return OPTION_REQUESTS[optionId] ?? '';
}

/** The request an answer to the helper's question stands for: a name for a new project, or a link to bring in. */
export function requestForAnswer(askId: string, answer: string): string {
  if (askId === 'open-project.name') return `start a new project called ${answer.trim()}`;
  if (askId === 'open-project.link') return `bring in ${answer.trim()}`;
  return answer;
}
