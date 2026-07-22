/** Extract plain text from ACP content blocks (nested-safe). */

export function textFromContent(content: unknown): string {
  if (content == null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (typeof content !== "object") {
    return "";
  }
  const c = content as {
    type?: string;
    text?: string;
    content?: unknown;
  };
  if (typeof c.text === "string" && c.text.length > 0) {
    return c.text;
  }
  if (Array.isArray(c.content)) {
    return (c.content as unknown[])
      .map((part) => textFromContent(part))
      .join("");
  }
  if (c.content && typeof c.content === "object") {
    return textFromContent(c.content);
  }
  return "";
}
