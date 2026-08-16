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
