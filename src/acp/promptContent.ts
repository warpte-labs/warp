/** Build ACP session/prompt content blocks from text + attachments. */

export type PromptAttachment = {
  name: string;
  mime?: string;
  size?: number;
  isImage?: boolean;
  dataBase64?: string;
  text?: string;
};

export type PromptBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export function buildPromptContent(
  text: string,
  attachments?: PromptAttachment[]
): PromptBlock[] {
  const blocks: PromptBlock[] = [];
  const trimmed = (text || "").trim();
  const atts = attachments || [];

  if (trimmed) {
    blocks.push({ type: "text", text: trimmed });
  }

  for (const a of atts) {
    if (a.isImage && a.dataBase64) {
      blocks.push({
        type: "image",
        data: a.dataBase64,
        mimeType: a.mime || "image/png",
      });
      continue;
    }
    if (typeof a.text === "string" && a.text.length > 0) {
      const cap = 120_000;
      const body =
        a.text.length > cap
          ? a.text.slice(0, cap) + "\n…(truncated)"
          : a.text;
      blocks.push({
        type: "text",
        text: `Attached file: ${a.name}\n\n\`\`\`\n${body}\n\`\`\``,
      });
      continue;
    }
    if (a.dataBase64) {
      const kb = a.size ? Math.round(a.size / 1024) : "?";
      blocks.push({
        type: "text",
        text: `Attached binary file: ${a.name} (${kb} KB, ${a.mime || "application/octet-stream"}). Content not inlined — describe how to use it if needed.`,
      });
      continue;
    }
    blocks.push({
      type: "text",
      text: `Attached: ${a.name}`,
    });
  }

  return blocks;
}

/** Append @-mention paths as a short reference block for the model. */
export function appendMentionRefs(
  text: string,
  mentions: unknown[]
): string {
  const list = mentions
    .map((m) => String(m || "").trim())
    .filter(Boolean);
  if (!list.length) {
    return text;
  }
  const block =
    "Referenced files:\n" + list.map((p) => `- ${p}`).join("\n");
  return text ? `${text}\n\n${block}` : block;
}
