// Geração de imagem por IA (Nano Banana / Gemini 2.5 Flash Image via OpenRouter).
// Mesma engrenagem que o motor já usa para trocar marcadores ADIMG:, agora
// reutilizável pela aba Mídia para o criador gerar uma foto sob demanda, sem
// sair do AD Studio e sem depender de ChatGPT/Genspark.

const IMAGE_MODEL = process.env.NEXT_PUBLIC_IMAGE_MODEL || "google/gemini-2.5-flash-image";
const IMG_BUCKET = "app-uploads";

/** Chama o Nano Banana e devolve um data: URL da imagem, ou null se falhar. */
export async function generateAiImage(
  apiKey: string,
  prompt: string,
  timeoutMs = 18_000
): Promise<string | null> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        modalities: ["image", "text"],
        messages: [
          {
            role: "user",
            content: `A high-quality, photorealistic, professional photograph: ${prompt}. Natural lighting, elegant, realistic. No text, no watermark, no logos.`,
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const msg = data?.choices?.[0]?.message;
    let url: any = msg?.images?.[0]?.image_url?.url ?? msg?.images?.[0]?.url;
    if (!url && Array.isArray(msg?.content)) {
      const part = msg.content.find((c: any) => c?.image_url?.url);
      url = part?.image_url?.url;
    }
    return typeof url === "string" && url.startsWith("data:") ? url : null;
  } catch {
    return null;
  }
}

// Placeholder que SEMPRE carrega (gradiente em data-URI). Usado quando a geração
// da imagem falha — nunca deixa a tela com imagem quebrada nem "ADIMG:" cru.
function adimgPlaceholder(): string {
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='800'>" +
    "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
    "<stop offset='0' stop-color='#f4e7ec'/><stop offset='1' stop-color='#e6eefb'/>" +
    "</linearGradient></defs><rect width='1200' height='800' fill='url(#g)'/></svg>";
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const ADIMG_MARKER = /ADIMG:\s*([^"'`)\n]+)/g;

interface ResolvableApp {
  files?: { path: string; content: string }[] | null;
  code?: string | null;
}

/**
 * Troca TODOS os marcadores src="ADIMG: ..." de um app por fotos reais geradas
 * por IA (Nano Banana) e salvas no bucket do projeto. Muta o app no lugar e
 * devolve quantas imagens foram geradas. Se uma imagem falhar, usa um placeholder
 * que sempre carrega — nunca deixa imagem quebrada. É o mesmo comportamento da
 * geração síncrona, agora disponível também para a fila durável (refinamentos por
 * etapas), que antes não resolvia as imagens e deixava as fotos novas quebradas.
 */
export async function resolveAdimgInApp(
  app: ResolvableApp,
  opts: { apiKey: string | null; supabase: any; projectId: string; max?: number; timeoutMs?: number }
): Promise<number> {
  const files = Array.isArray(app.files) ? app.files : null;
  const texts: string[] = [];
  if (files) files.forEach((f) => texts.push(f.content));
  if (typeof app.code === "string") texts.push(app.code);

  const prompts = new Map<string, string>();
  for (const t of texts) {
    let m: RegExpExecArray | null;
    const re = new RegExp(ADIMG_MARKER.source, "g");
    while ((m = re.exec(t))) {
      const prompt = m[1].trim();
      if (prompt) prompts.set(prompt.toLowerCase(), prompt);
    }
  }
  if (!prompts.size) return 0;

  const map = new Map<string, string>();
  await Promise.all(
    Array.from(prompts.entries())
      .slice(0, opts.max ?? 12)
      .map(async ([key, prompt]) => {
        let url: string | null = null;
        if (opts.apiKey) {
          const dataUrl = await generateAiImage(opts.apiKey, prompt, opts.timeoutMs ?? 16_000);
          if (dataUrl && opts.supabase) url = await storeAiImage(opts.supabase, opts.projectId, dataUrl);
        }
        map.set(key, url || adimgPlaceholder());
      })
  );

  const swap = (t: string) =>
    t.replace(new RegExp(ADIMG_MARKER.source, "g"), (_m, value) => {
      const key = String(value).trim().toLowerCase();
      return map.get(key) || adimgPlaceholder();
    });

  if (files) app.files = files.map((f) => ({ ...f, content: swap(f.content) }));
  if (typeof app.code === "string") app.code = swap(app.code);

  let generated = 0;
  map.forEach((v) => {
    if (v && /^https?:\/\//.test(v)) generated += 1;
  });
  return generated;
}

/** Guarda um data: URL no bucket do projeto e devolve a URL pública, ou null. */
export async function storeAiImage(
  supabase: any,
  projectId: string,
  dataUrl: string
): Promise<string | null> {
  try {
    const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (!m) return null;
    const contentType = m[1];
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length < 100 || bytes.length > 6_000_000) return null;
    const extMap: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
    const path = `${projectId}/ai-${crypto.randomUUID()}.${extMap[contentType] || "png"}`;
    const { error } = await supabase.storage.from(IMG_BUCKET).upload(path, bytes, { contentType, upsert: false });
    if (error) return null;
    return supabase.storage.from(IMG_BUCKET).getPublicUrl(path).data.publicUrl as string;
  } catch {
    return null;
  }
}
