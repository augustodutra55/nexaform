import type { AppFile } from "@/lib/engine/app-types";

export type MediaKind = "image" | "video";

export interface ProjectMediaItem {
  id: string;
  filePath: string;
  source: string;
  context: string;
  kind: MediaKind;
  offset: number;
}

export interface ProjectMediaAsset {
  id: string;
  url: string;
  path: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
}

function clean(value: string | null | undefined): string {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{[^{}]*\}/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[^a-zA-Z0-9À-ÿ\s,'&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function nearest(source: string, offset: number, pattern: RegExp): string {
  const start = Math.max(0, offset - 1200);
  const end = Math.min(source.length, offset + 1200);
  const window = source.slice(start, end);
  let best = "";
  let distance = Number.POSITIVE_INFINITY;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(window))) {
    const value = clean(match[1]);
    if (!value || /^(imagem|image|foto|photo|vídeo|video)$/i.test(value)) continue;
    const nextDistance = Math.abs(start + match.index - offset);
    if (nextDistance < distance) {
      best = value;
      distance = nextDistance;
    }
  }
  return best;
}

function contextFor(source: string, offset: number, tag: string, projectName: string): string {
  const alt = tag.match(/(?:alt|aria-label|title)\s*=\s*(?:["']([^"']+)["']|\{\s*["']([^"']+)["']\s*\})/i);
  const own = clean(alt?.[1] || alt?.[2]);
  if (own) return own;

  const property = nearest(
    source,
    offset,
    /(?:title|titulo|título|name|nome|label|alt)\s*:\s*["'`]([^"'`]{2,160})["'`]/gi
  );
  if (property) return property;

  const heading = nearest(source, offset, /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi);
  return heading || clean(projectName) || "Conteúdo principal";
}

function mediaKind(tagName: string, source: string): MediaKind {
  if (/^(video|source)$/i.test(tagName) || /\.(mp4|webm|mov)(?:[?#]|$)/i.test(source)) return "video";
  return "image";
}

/** Lista mídias estáticas que podem ser substituídas sem regenerar o projeto. */
export function findProjectMedia(files: AppFile[], projectName: string): ProjectMediaItem[] {
  const items: ProjectMediaItem[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const tagPattern = /<(img|video|source)\b[^>]*\bsrc\s*=\s*(?:["']([^"']*)["']|\{\s*["']([^"']*)["']\s*\})[^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(file.content))) {
      const source = match[2] ?? match[3];
      if (source === undefined || (!source && !/^(video|source)$/i.test(match[1]))) continue;
      const relative = match[0].indexOf(source);
      const offset = match.index + Math.max(relative, 0);
      const key = `${file.path}:${offset}:${source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: key,
        filePath: file.path,
        source,
        context: contextFor(file.content, offset, match[0], projectName),
        kind: mediaKind(match[1], source),
        offset,
      });
    }

    const propertyPattern = /(?:image|imagem|photo|foto|video|vídeo|src)\s*:\s*["'`]([^"'`]+)["'`]/gi;
    while ((match = propertyPattern.exec(file.content))) {
      const source = match[1];
      if (!source || (!/^ADIMG:/i.test(source) && !/^https?:\/\//i.test(source))) continue;
      const relative = match[0].indexOf(source);
      const offset = match.index + Math.max(relative, 0);
      const key = `${file.path}:${offset}:${source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: key,
        filePath: file.path,
        source,
        context: contextFor(file.content, offset, match[0], projectName),
        kind: mediaKind(/video|vídeo/i.test(match[0]) ? "video" : "img", source),
        offset,
      });
    }
  }

  return items;
}

export function buildMediaPrompt(item: ProjectMediaItem | null, projectName: string, kind: MediaKind): string {
  const context = item?.context || projectName || "conteúdo principal";
  const aspect = /\b(hero|banner|capa|abertura|destaque)\b/i.test(context)
    ? "16:9 landscape"
    : /\b(avatar|perfil|depoimento|testimonial)\b/i.test(context)
      ? "1:1 square"
      : "4:3 landscape";
  if (kind === "video") {
    return `Create a professional cinematic video for ${projectName}. The scene must accurately represent "${context}". ${aspect}, 6 to 8 seconds, natural motion, realistic lighting, premium commercial quality, stable camera, no text, no subtitles, no watermark, no logos.`;
  }
  return `Create a professional photorealistic image for ${projectName}. The image must accurately represent "${context}" and match that specific content block. ${aspect}, high-detail premium commercial photography, natural realistic lighting, clean composition, no text, no watermark, no logos.`;
}

export function replaceProjectMedia(files: AppFile[], item: ProjectMediaItem, nextUrl: string): AppFile[] | null {
  let changed = false;
  const next = files.map((file) => {
    if (file.path !== item.filePath) return file;
    let offset = item.offset;
    if (file.content.slice(offset, offset + item.source.length) !== item.source) offset = file.content.indexOf(item.source);
    if (offset < 0) return file;
    changed = true;
    return {
      ...file,
      content: file.content.slice(0, offset) + nextUrl + file.content.slice(offset + item.source.length),
    };
  });
  return changed ? next : null;
}
