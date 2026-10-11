import { saveOutcome, setFragmentRequest } from '../domain/SaveOutcome.ts';
import type { CodeFragment, LinePagesApi, SaveOutcome } from '../types';

/** One code Save (cx1): POST /api/line/fragment with just that fragment's new code, then the sentence to show. Empty
 * code is refused here, nothing sent. Never throws: a silent server is a refusal too. */
export async function saveCodeFragment(api: LinePagesApi, fragment: CodeFragment, code: string): Promise<SaveOutcome> {
  if (!code.trim()) return { ok: false, sentence: 'Nothing was saved: the code is empty, so write the expression to use.', findings: [] };
  try {
    return saveOutcome(await api.setFragment(setFragmentRequest(fragment, code)));
  } catch {
    return saveOutcome(null);
  }
}
