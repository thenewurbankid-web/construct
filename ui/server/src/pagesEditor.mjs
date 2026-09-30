// pagesEditor.mjs's implementation is pure logic (JSX tree edits, Palette
// insertion, enforcement checks) with no Cockpit-server dependency beyond a
// path-containment helper, so it now lives in packages/engine where
// construct's own root tests (paletteInsert/paletteWrapConfirm) can import
// it without pulling in the rest of ui/server (#813). This re-export keeps
// every existing ui/server caller and colocated test working unchanged.
export * from '../../../packages/engine/pagesEditor.mjs';
