const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

function chunkCode(code) {
  const ast = parser.parse(code, { sourceType: 'module' });
  const chunks = [];

  traverse(ast, {
    ClassMethod(path) {
      const { node } = path;
      chunks.push({
        kind: 'method',
        name: node.key.name || node.key.value || '(anonymous)',
        code: code.slice(node.start, node.end),
        start: node.start,
        end: node.end,
      });
      path.skip();
    },
    FunctionDeclaration(path) {
      if (!path.parentPath.isProgram()) return;
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
