const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

function chunkCode(code) {
  // TypeScript + JSX, same as toEnglish: Construct's code is .ts/.tsx.
  const ast = parser.parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const chunks = [];

  traverse(ast, {
    'ClassMethod|ClassPrivateMethod'(path) {
      const { node } = path;
      chunks.push({
        kind: 'method',
        name: node.key.name || node.key.value || (node.key.id && node.key.id.name) || '(anonymous)',
        code: code.slice(node.start, node.end),
        start: node.start,
        end: node.end,
      });
      path.skip();
    },
    FunctionDeclaration(path) {
      // A top-level function, or one wrapped in `export` / `export default`
      // at the top level. The chunk's code is the bare function (no
      // `export` keyword), the shape every downstream step parses.
      const parent = path.parentPath;
      const topLevel = parent.isProgram()
        || ((parent.isExportNamedDeclaration() || parent.isExportDefaultDeclaration()) && parent.parentPath.isProgram());
      if (!topLevel || !path.node.body) return;
      const { node } = path;
      chunks.push({
        kind: 'function',
        name: node.id ? node.id.name : '(anonymous)',
        code: code.slice(node.start, node.end),
        start: node.start,
        end: node.end,
      });
      path.skip();
    },
  });

  chunks.sort((a, b) => a.start - b.start);
  chunks.forEach((c, i) => (c.id = i));
  return chunks;
}

module.exports = { chunkCode };
