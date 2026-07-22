/**
 * Extract plain text from ACP content blocks.
 * Matches Grok/ACP shapes: string, { text }, { content: [...] }, arrays, deltas.
 * @see https://agentclientprotocol.com + Grok agent-mode docs (agent_*_chunk)
 */

export function textFromContent(content: unknown): string {
  if (content == null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => textFromContent(part)).join("");
  }
  if (typeof content !== "object") {
    return "";
  }
  const c = content as Record<string, unknown>;
  // Grok sample: update.content?.text
  if (typeof c.text === "string") {
    return c.text;
  }
  if (typeof c.delta === "string") {
    return c.delta;
  }
  if (typeof c.text_delta === "string") {
    return c.text_delta;
  }
  if (c.content != null) {
    return textFromContent(c.content);
  }
  if (c.parts != null) {
    return textFromContent(c.parts);
  }
  return "";
}
