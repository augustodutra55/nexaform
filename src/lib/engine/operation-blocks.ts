export interface OperationBlockResult {
  reply: string;
  ops: Array<{ op: "create" | "update" | "delete"; path: string; content?: string }>;
}

/**
 * Extrai arquivos brutos de uma resposta de refinamento sem depender de JSON.
 * Também aceita o padrão Markdown comum como rede de segurança quando o modelo
 * acrescenta um título de arquivo antes da cerca de código.
 */
export function parseOperationBlocks(text: string): OperationBlockResult | null {
  const ops: OperationBlockResult["ops"] = [];
  const filePattern = /<AD_FILE\b([^>]*)>([\s\S]*?)<\/AD_FILE>/gi;
  let fileMatch: RegExpExecArray | null;
  while ((fileMatch = filePattern.exec(text)) !== null) {
    const attributes = fileMatch[1];
    const pathMatch = /\bpath\s*=\s*["']([^"']+)["']/i.exec(attributes);
    if (!pathMatch) continue;
    const opMatch = /\bop\s*=\s*["'](create|update)["']/i.exec(attributes);
    const content = fileMatch[2]
      .trim()
      .replace(/^```(?:jsx|tsx|js|ts)?\s*\r?\n?/i, "")
      .replace(/\r?\n?```\s*$/, "")
      .trim();
    if (!content) continue;
    ops.push({
      op: opMatch?.[1]?.toLowerCase() === "create" ? "create" : "update",
      path: pathMatch[1],
      content,
    });
  }

  const deletePattern = /<AD_DELETE\b([^>]*)\/?\s*>/gi;
  let deleteMatch: RegExpExecArray | null;
  while ((deleteMatch = deletePattern.exec(text)) !== null) {
    const pathMatch = /\bpath\s*=\s*["']([^"']+)["']/i.exec(deleteMatch[1]);
    if (pathMatch) ops.push({ op: "delete", path: pathMatch[1] });
  }

  if (!ops.length) {
    const markdownPattern = /(?:^|\n)(?:#{1,6}\s*)?(?:arquivo\s*:\s*)?`?([\w./-]+\.(?:jsx|tsx|js|ts))`?\s*\r?\n```(?:jsx|tsx|js|ts)?\s*\r?\n([\s\S]*?)```/gi;
    let markdownMatch: RegExpExecArray | null;
    while ((markdownMatch = markdownPattern.exec(text)) !== null) {
      const content = markdownMatch[2].trim();
      if (content) ops.push({ op: "update", path: markdownMatch[1], content });
    }
  }

  if (!ops.length) return null;
  const replyMatch = /<AD_REPLY>([\s\S]*?)<\/AD_REPLY>/i.exec(text);
  return {
    reply: replyMatch?.[1]?.trim() || "Pronto! Arquivos atualizados.",
    ops,
  };
}
