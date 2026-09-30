// coreExecutor.mjs is pure logic (CLI-binary resolution, subprocess spawn, JSON-output
// parsing) with no Cockpit-server dependency at all, so it now lives in
// packages/engine where construct's own root tests (executionModeParity/Review/Verbs)
// can import it without pulling in the rest of ui/server (#813). This re-export keeps
// every existing ui/server caller and colocated test working unchanged.
export * from '../../../packages/engine/coreExecutor.mjs';
