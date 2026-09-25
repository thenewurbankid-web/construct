// #653 -- the proof routes of the Requirement screen. The cases live in requirementProof.cases.mjs; this file only decides whether
// they can run here: they build a real `construct init` project and RUN its proof, which needs react, react-dom, esbuild and
// typescript. A lane with only the root install has no react-dom, so it skips with the reason instead of crashing.
import test from 'node:test';
import { PROOF_RUNTIME_MISSING, proofRuntimeAvailable } from '../../../test-utils/proofProject.mjs';

if (proofRuntimeAvailable()) await import('./requirementProof.cases.mjs');
else test('the proof routes run against a real project', { skip: PROOF_RUNTIME_MISSING }, () => {});
