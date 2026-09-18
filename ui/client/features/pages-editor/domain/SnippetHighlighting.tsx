import Prism from 'prismjs';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';

// Pure (DOMAIN-001) — JSX-aware syntax highlighting for the isolated
// snippet editor (#81, extending #52). Prism.highlight() tokenizes and
// stringifies a fixed grammar with no environment access of its own — it
// never touches anything outside the string it's given — so this stays a
// plain string-in, string-out function. The returned markup is escaped by
// Prism itself and safe to render as HTML.
export function highlightJsxSnippet(code: string): string {
  return Prism.highlight(code, Prism.languages.jsx, 'jsx');
}
