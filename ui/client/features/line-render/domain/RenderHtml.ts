// Pure (DOMAIN-001): the rendered document as the sandboxed frame shows it.

/** The frame runs no scripts (sandbox="" on purpose: the picture is static), so script elements are taken out before
 * it gets the document; left in, the browser logs one "Blocked script execution" error per script. */
export function staticHtml(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/<script\b[^>]*\/>/gi, '');
}
