import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** The model's prose, rendered as markdown (code blocks, lists, tables). Raw HTML in the text is never rendered
 * (react-markdown's default), and links open in a new tab without giving the target a handle back. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: label }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
