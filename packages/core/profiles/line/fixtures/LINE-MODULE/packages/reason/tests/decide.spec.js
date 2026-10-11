// @mx/reason's own test, run against its mock.
import { decide } from '../mock.js';

export async function decideAnswers() {
  const r = await decide('hello');
  if (typeof r.response !== 'string') throw new Error('decide must answer with a response');
}
