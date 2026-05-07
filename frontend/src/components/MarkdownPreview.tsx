import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  content: string;
}

const style: React.CSSProperties = {
  padding: "1.25rem 1.5rem",
  overflowY: "auto",
  flex: 1,
  fontSize: "0.875rem",
  lineHeight: 1.7,
  color: "#e2e8f0",
};

export function MarkdownPreview({ content }: Props) {
  return (
    <div style={style}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.75rem", color: "#f8fafc" }}>
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 style={{ fontSize: "1.05rem", fontWeight: 600, marginTop: "1.25rem", marginBottom: "0.5rem", color: "#cbd5e1" }}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginTop: "1rem", marginBottom: "0.4rem", color: "#94a3b8" }}>
              {children}
            </h3>
          ),
          p: ({ children }) => <p style={{ marginBottom: "0.75rem" }}>{children}</p>,
          ul: ({ children }) => <ul style={{ paddingLeft: "1.25rem", marginBottom: "0.75rem" }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ paddingLeft: "1.25rem", marginBottom: "0.75rem" }}>{children}</ol>,
          li: ({ children }) => <li style={{ marginBottom: "0.25rem" }}>{children}</li>,
          code: ({ children, className }) => {
            const isBlock = className?.startsWith("language-");
            return isBlock ? (
              <pre style={{ background: "#1e293b", padding: "0.75rem", borderRadius: "0.375rem", overflowX: "auto", marginBottom: "0.75rem" }}>
                <code style={{ fontSize: "0.8rem", color: "#7dd3fc" }}>{children}</code>
              </pre>
            ) : (
              <code style={{ background: "#1e293b", padding: "0.1em 0.3em", borderRadius: "0.2rem", fontSize: "0.85em", color: "#7dd3fc" }}>
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div style={{ overflowX: "auto", marginBottom: "0.75rem" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem" }}>
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th style={{ border: "1px solid #334155", padding: "0.4rem 0.6rem", background: "#1e293b", textAlign: "left" }}>
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td style={{ border: "1px solid #334155", padding: "0.4rem 0.6rem" }}>{children}</td>
          ),
          blockquote: ({ children }) => (
            <blockquote style={{ borderLeft: "3px solid #475569", paddingLeft: "0.75rem", color: "#94a3b8", marginBottom: "0.75rem" }}>
              {children}
            </blockquote>
          ),
          hr: () => <hr style={{ border: "none", borderTop: "1px solid #334155", margin: "1rem 0" }} />,
          strong: ({ children }) => <strong style={{ color: "#f1f5f9" }}>{children}</strong>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
