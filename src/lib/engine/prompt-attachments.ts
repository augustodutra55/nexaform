export type PromptAttachmentKind = "image" | "text";

export interface PromptAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: PromptAttachmentKind;
  /** Data URL para imagens; texto UTF-8 para arquivos de texto/código. */
  content: string;
}

export const PROMPT_ATTACHMENT_ACCEPT =
  "image/png,image/jpeg,image/webp,text/plain,text/markdown,text/csv,application/json,.js,.jsx,.ts,.tsx,.html,.css,.md,.txt,.csv,.json";
export const MAX_PROMPT_ATTACHMENTS = 4;
export const MAX_PROMPT_TEXT_BYTES = 200 * 1024;
export const MAX_PROMPT_IMAGE_BYTES = 1_000_000;
/** Mantém o JSON completo abaixo do limite de corpo comum das funções serverless. */
export const MAX_PROMPT_TOTAL_BYTES = 1_500_000;

const TEXT_EXT = /\.(?:txt|md|csv|json|js|jsx|ts|tsx|html|css)$/i;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Não foi possível preparar a imagem."));
    image.src = dataUrl;
  });
}

async function optimizedImage(file: File): Promise<{ content: string; type: string; size: number }> {
  const original = await readDataUrl(file);
  if (file.size <= MAX_PROMPT_IMAGE_BYTES) return { content: original, type: file.type, size: file.size };

  const image = await loadImage(original);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Seu navegador não conseguiu preparar a imagem.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let quality = 0.86;
  let content = canvas.toDataURL("image/jpeg", quality);
  while (content.length * 0.75 > MAX_PROMPT_IMAGE_BYTES && quality > 0.45) {
    quality -= 0.1;
    content = canvas.toDataURL("image/jpeg", quality);
  }
  const size = Math.round(content.length * 0.75);
  if (size > MAX_PROMPT_IMAGE_BYTES) {
    throw new Error("A imagem continuou muito grande após a otimização. Use uma imagem menor.");
  }
  return { content, type: "image/jpeg", size };
}

export async function preparePromptAttachment(file: File): Promise<PromptAttachment> {
  if (IMAGE_TYPES.has(file.type)) {
    const prepared = await optimizedImage(file);
    return {
      id: crypto.randomUUID(),
      name: file.name,
      type: prepared.type,
      size: prepared.size,
      kind: "image",
      content: prepared.content,
    };
  }

  const isText = file.type.startsWith("text/") || file.type === "application/json" || TEXT_EXT.test(file.name);
  if (!isText) throw new Error("Formato não suportado. Anexe imagem, texto ou arquivo de código.");
  if (file.size > MAX_PROMPT_TEXT_BYTES) throw new Error("Arquivo de texto maior que 200 KB.");
  return {
    id: crypto.randomUUID(),
    name: file.name,
    type: file.type || "text/plain",
    size: file.size,
    kind: "text",
    content: await file.text(),
  };
}

export function attachmentLabel(attachment: PromptAttachment): string {
  return `${attachment.kind === "image" ? "Imagem" : "Arquivo"}: ${attachment.name}`;
}

export function attachmentPayloadBytes(attachment: PromptAttachment): number {
  return attachment.kind === "image" ? attachment.size : new Blob([attachment.content]).size;
}

/** Validação server-side: nunca confia no JSON/base64 enviado pelo navegador. */
export function sanitizePromptAttachments(value: unknown): PromptAttachment[] {
  if (!Array.isArray(value)) return [];
  const safe: PromptAttachment[] = [];
  let totalBytes = 0;
  for (const raw of value.slice(0, MAX_PROMPT_ATTACHMENTS)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Partial<PromptAttachment>;
    const name = typeof item.name === "string" ? item.name.replace(/[\r\n]/g, " ").slice(0, 160) : "arquivo";
    const type = typeof item.type === "string" ? item.type.toLowerCase().slice(0, 80) : "";
    const content = typeof item.content === "string" ? item.content : "";
    if (item.kind === "text" && content && content.length <= MAX_PROMPT_TEXT_BYTES) {
      const bytes = new TextEncoder().encode(content).byteLength;
      if (totalBytes + bytes > MAX_PROMPT_TOTAL_BYTES) continue;
      totalBytes += bytes;
      safe.push({ id: String(item.id || safe.length), name, type: type || "text/plain", size: bytes, kind: "text", content });
      continue;
    }
    if (item.kind === "image" && IMAGE_TYPES.has(type)) {
      const match = content.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i);
      if (!match || match[1].toLowerCase() !== type) continue;
      const estimatedBytes = Math.floor(match[2].length * 0.75);
      if (estimatedBytes <= 0 || estimatedBytes > MAX_PROMPT_IMAGE_BYTES || totalBytes + estimatedBytes > MAX_PROMPT_TOTAL_BYTES) continue;
      totalBytes += estimatedBytes;
      safe.push({ id: String(item.id || safe.length), name, type, size: estimatedBytes, kind: "image", content });
    }
  }
  return safe;
}
