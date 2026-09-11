/** Renders HTML that `renderMarkdown()` already sanitised on the server. */
export function Markdown({ html, className }: { html: string; className?: string }) {
  return <div className={className ?? "prose"} dangerouslySetInnerHTML={{ __html: html }} />;
}
