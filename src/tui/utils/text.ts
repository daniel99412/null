export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split(/\n\n+/);

  for (const paragraph of paragraphs) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }

    const paraLines = paragraph.split("\n");
    for (const paraLine of paraLines) {
      const words = paraLine.split(" ");
      let line = "";

      for (const w of words) {
        if ((line + w).length > width) {
          lines.push(line);
          line = w + " ";
        } else {
          line += w + " ";
        }
      }

      if (line.trim()) lines.push(line);
    }
  }

  return lines;
}

export function formatMessage(
  content: string,
  role: "user" | "assistant",
  width: number,
): string[] {
  const prefix = role === "user" ? "❯ " : "  ";
  const wrapped = wrapText(content, width - 4);
  return wrapped.map((l, i) => (i === 0 ? prefix + l : "  " + l));
}
