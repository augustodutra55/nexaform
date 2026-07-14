import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateAppWithProviders } from "@/lib/engine/code-providers";
import { isOwner, resolvePlan } from "@/lib/access";
import type { AppCode } from "@/lib/engine/app-types";
import { authorizeProjectOwner, consumeRateLimit } from "@/lib/engine/data-guard";
import { finalizeGeneration, reserveGeneration } from "@/lib/engine/generation-usage";
import { sanitizePromptAttachments } from "@/lib/engine/prompt-attachments";

// Apps grandes + auto-cura (retry/fallback) podem passar de 2 min; damos folga
// para o servidor não cortar a resposta no meio (o que virava "não é JSON válido").
export const maxDuration = 300;
// Fallback de chave: OPENROUTER_API_KEY (env da Vercel) garante geração mesmo se o navegador limpar a chave do usuário.

// TEMPO MÁXIMO da geração antes de cortar com um aviso claro (em vez do erro cru
// da Vercel). No plano HOBBY a função é cortada em ~60s, então o padrão é 50s.
// Ao ATIVAR O PLANO PRO (até 300s), basta definir a env GEN_MAX_MS=280000 nas
// Environment Variables da Vercel — o motor passa a usar quase todo o tempo e as
// gerações grandes (sites complexos, vídeo/imagens pesadas) completam. Sem tocar
// no código: é só a chavinha.
const configuredMaxMs = Number(process.env.GEN_MAX_MS);
const GEN_MAX_MS = Number(process.env.GEN_MAX_MS) || 280000;
const IMG_CEIL_MS = GEN_MAX_MS + 8_000; // janela para gerar imagem por IA depois do código

// ---- Geração de imagens custom (Nano Banana / Gemini Flash Image via OpenRouter) ----
// O motor pode emitir marcadores  src="ADIMG: descrição em inglês"  onde quiser uma
// foto sob medida. Aqui, PÓS-geração, trocamos cada marcador por uma imagem gerada
// por IA e guardada no bucket público. Sem chave OpenRouter (ou em qualquer falha),
// cai num fallback que sempre carrega — nunca deixamos "ADIMG:" cru na tela nem
// quebramos a build.
const IMAGE_MODEL = process.env.NEXT_PUBLIC_IMAGE_MODEL || "google/gemini-2.5-flash-image";
const IMG_BUCKET = "app-uploads";
const MAX_IMAGES = 10; // cobre hero + uma grade comum de serviços sem serializar chamadas
const IMG_MARKER = /ADIMG:\s*([^"'`)\n]+)/g;
const STOCK_IMAGE = /https?:\/\/(?:www\.)?(?:loremflickr\.com\/\d+\/\d+\/[^"'`\s)]+|picsum\.photos\/[^"'`\s)]+|source\.unsplash\.com\/[^"'`\s)]+)/g;

async function genImage(apiKey: string, prompt: string, timeoutMs = 18_000): Promise<string | null> {
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

async function storeImage(supabase: any, projectId: string, dataUrl: string): Promise<string | null> {
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
    return supabase.storage.from(IMG_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

function imgFallback(prompt: string): string {
  const theme = (prompt || "professional business").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ",").replace(/^,+|,+$/g, "").slice(0, 80) || "professional,business";
  let lock = 0;
  for (let i = 0; i < theme.length; i++) lock = (lock * 31 + theme.charCodeAt(i)) % 1000;
  return `https://loremflickr.com/1200/800/${theme}?lock=${lock || 1}`;
}

function cleanImageContext(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\{[^{}]*\}/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[^a-zA-Z0-9À-ÿ\s,'&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function staticAttribute(tag: string, attribute: string): string {
  const match = tag.match(new RegExp(`${attribute}\\s*=\\s*(?:["']([^"']+)["']|\\{\\s*["']([^"']+)["']\\s*\\})`, "i"));
  return cleanImageContext(match?.[1] || match?.[2]);
}

function nearestMatch(source: string, offset: number, pattern: RegExp): string {
  const start = Math.max(0, offset - 1200);
  const end = Math.min(source.length, offset + 1200);
  const window = source.slice(start, end);
  let best = "";
  let bestDistance = Number.POSITIVE_INFINITY;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(window))) {
    const value = cleanImageContext(match[1]);
    if (!value || /^(imagem|image|foto|photo)$/i.test(value)) continue;
    const distance = Math.abs(start + match.index - offset);
    if (distance < bestDistance) {
      best = value;
      bestDistance = distance;
    }
  }
  return best;
}

/** Obtém primeiro o alt da própria imagem e depois o título estático mais perto.
 * Também cobre cards orientados a dados: { title: "...", image: "..." }. */
function imageContext(source: string, offset: number, appName: string): string {
  const imgStart = Math.max(source.lastIndexOf("<img", offset), source.lastIndexOf("<Image", offset));
  const imgEnd = source.indexOf(">", offset);
  if (imgStart >= 0 && imgEnd > offset && offset - imgStart < 1000 && imgEnd - offset < 1000) {
    const tag = source.slice(imgStart, imgEnd + 1);
    const alt = staticAttribute(tag, "alt") || staticAttribute(tag, "aria-label");
    if (alt) return alt;
  }

  const property = nearestMatch(
    source,
    offset,
    /(?:title|titulo|título|name|nome|label|alt)\s*:\s*["'`]([^"'`]{2,160})["'`]/gi
  );
  if (property) return property;

  const heading = nearestMatch(source, offset, /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi);
  return heading || cleanImageContext(appName) || "professional business";
}

function urlTheme(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host === "loremflickr.com") {
      return decodeURIComponent(parsed.pathname.split("/").slice(3).join(" ")).replace(/[,/_+-]+/g, " ").trim();
    }
    if (host === "source.unsplash.com") {
      const query = parsed.searchParams.get("q") || parsed.searchParams.get("query") || parsed.search.replace(/^\?/, "");
      return decodeURIComponent(query).replace(/[,/_+&=-]+/g, " ").replace(/\b\d+x\d+\b/g, " ").trim();
    }
  } catch {
    /* usa apenas o contexto local */
  }
  return "";
}

function stockPrompt(url: string, source: string, offset: number, appName: string): string {
  const context = imageContext(source, offset, appName);
  const theme = cleanImageContext(urlTheme(url));
  return [theme, context, `professional content for ${cleanImageContext(appName) || "business"}`]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(", ")
    .slice(0, 260);
}

/** Troca marcadores ADIMG: por imagens custom (via OpenRouter) armazenadas no
 *  bucket. Muta o `app`. Devolve quantas imagens reais foram geradas. */
async function resolveAiImages(
  app: AppCode,
  supabase: any,
  opts: { userKey: string | null; userProvider: string | null; projectId: string; budgetMs?: number }
): Promise<number> {
  const texts: string[] = [];
  if (Array.isArray(app.files)) app.files.forEach((f) => texts.push(f.content));
  if (typeof app.code === "string") texts.push(app.code);
  const hasImg = texts.some((t) => new RegExp(IMG_MARKER.source).test(t) || new RegExp(STOCK_IMAGE.source).test(t));
  if (!hasImg) return 0;

  const prompts: string[] = [];
  for (const t of texts) {
    let m: RegExpExecArray | null;
    const reA = new RegExp(IMG_MARKER.source, "g");
    while ((m = reA.exec(t))) {
      const prompt = m[1].trim();
      if (prompt && !prompts.includes(prompt)) prompts.push(prompt);
    }
    const reStock = new RegExp(STOCK_IMAGE.source, "g");
    while ((m = reStock.exec(t))) {
      const prompt = stockPrompt(m[0], t, m.index, app.name);
      if (prompt && !prompts.includes(prompt)) prompts.push(prompt);
    }
  }

  const map = new Map<string, string>();
  if (opts.userKey && opts.userProvider === "openrouter") {
    await Promise.all(
      prompts.slice(0, MAX_IMAGES).map(async (prompt) => {
        const dataUrl = await genImage(opts.userKey!, prompt, Math.min(18_000, Math.max(4_000, opts.budgetMs ?? 18_000)));
        const stored = dataUrl ? await storeImage(supabase, opts.projectId, dataUrl) : null;
        if (stored) map.set(prompt, stored);
      })
    );
  }

  const swap = (t: string) => {
    let out = t.replace(new RegExp(IMG_MARKER.source, "g"), (_m, value) => {
      const prompt = String(value).trim();
      return map.get(prompt) || imgFallback(prompt);
    });
    out = out.replace(new RegExp(STOCK_IMAGE.source, "g"), (url, offset) => {
      const prompt = stockPrompt(String(url), t, Number(offset), app.name);
      return map.get(prompt) || imgFallback(prompt);
    });
    return out;
  };
  if (Array.isArray(app.files)) app.files = app.files.map((f) => ({ ...f, content: swap(f.content) }));
  if (typeof app.code === "string") app.code = swap(app.code);
  return map.size;
}
// ---- fim da geração de imagens custom ----

export async function POST(req: NextRequest) {
  const started = Date.now();
  const supabase = await createClient();
  const imageStorage = createAdminClient() ?? supabase;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const owner = isOwner({ role: profile?.role, email: user.email });

  if (!owner && !(await consumeRateLimit(`generation:${user.id}`, Number(process.env.GENERATION_RATE_LIMIT ?? 20), 60 * 60_000))) {
    return NextResponse.json({ error: "Muitas gerações em pouco tempo. Aguarde e tente de novo." }, { status: 429 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }
  const { projectId, message, currentCode, currentFiles, name, userKey, userProvider, costMode, forceReal, allowTemplate } =
    body ?? {};
  if (!projectId || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Requisição incompleta." }, { status: 400 });
  }

  const access = await authorizeProjectOwner(supabase, projectId, user.id, owner);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status ?? 403 });
  }
  const attachments = sanitizePromptAttachments(body?.attachments);

  const { data: sub } = owner ? { data: null } : await supabase.from("subscriptions").select("plan").eq("user_id", user.id).maybeSingle();
  const plan = resolvePlan({ plan: sub?.plan, role: profile?.role, email: user.email });
  const reservation = await reserveGeneration({ supabase, userId: user.id, projectId, prompt: message, limit: plan.maxGenerationsPerMonth, unlimited: owner });
  if (reservation.error) return NextResponse.json({ error: "Não foi possível reservar sua geração. Tente novamente." }, { status: 503 });
  if (reservation.limitReached) return NextResponse.json(
    { error: `Limite de ${plan.maxGenerationsPerMonth} gerações do plano ${plan.name} atingido este mês.`, limitReached: true },
    { status: 402 }
  );

  // No plano Hobby da Vercel a função é cortada em ~60s (o maxDuration=300 é
  // IGNORADO nesse plano). Se a geração passar disso, a Vercel devolve uma página
  // de erro crua ("An error occurred") que o cliente não consegue ler como JSON.
  // Então cortamos NÓS em 50s e devolvemos um aviso claro em JSON.
  const DEADLINE = { __timeout: true as const };
  let raced: Awaited<ReturnType<typeof generateAppWithProviders>> | typeof DEADLINE;
  try {
    raced = await Promise.race([
      generateAppWithProviders({ message, currentCode: typeof currentCode === "string" ? currentCode : null,
        currentFiles: Array.isArray(currentFiles) ? currentFiles : null,
        name: typeof name === "string" ? name : "App", userKey: typeof userKey === "string" ? userKey : null,
        userProvider: userProvider ?? null, costMode: costMode ?? "auto",
        forceReal: forceReal !== false, allowTemplate: allowTemplate === true, attachments }),
      new Promise<typeof DEADLINE>((resolve) => setTimeout(() => resolve(DEADLINE), GEN_MAX_MS)),
    ]);
  } catch (error) {
    await finalizeGeneration(supabase, reservation.id, { status: "failed" });
    console.error("[generation] falha inesperada", error);
    return NextResponse.json({ error: "A geração falhou antes de concluir. Tente novamente." }, { status: 502 });
  }
  if ((raced as any).__timeout) {
    await finalizeGeneration(supabase, reservation.id, { status: "failed" });
    return NextResponse.json(
      {
        error:
          `A geração passou do tempo limite (~${Math.round(GEN_MAX_MS / 1000)}s) e parei antes para te dar um aviso claro em vez de um erro quebrado. Tente um pedido menor ou o modo Econômico. Para gerações grandes (sites complexos, vídeo, imagens pesadas), ative o plano Pro da Vercel e defina a env GEN_MAX_MS=280000.`,
        timeout: true,
        engineMode: "template",
      },
      { status: 504 }
    );
  }
  const result = raced as Awaited<ReturnType<typeof generateAppWithProviders>>;

  // Modo real exigido, mas a IA não gerou. Se temos o motivo técnico real
  // (ex.: modelo 404, chave 401, sem saldo, timeout), mostramos ELE — nada de
  // "nenhuma IA conectada" genérico quando na verdade a chamada falhou.
  if (forceReal !== false && result.engineMode !== "real") {
    const reason = (result as any).failureReason as string | undefined;
    const error = reason
      ? `A geração real falhou: ${reason} — não vou te entregar um demo disfarçado. Verifique sua chave/modelo em Configurações, ou troque para o modo Template/Demo.`
      : "Modo de geração real ativo, mas nenhuma IA está conectada — não vou te entregar um demo disfarçado. Conecte uma chave de IA em Configurações (ou troque para o modo Template/Demo explicitamente).";
    await finalizeGeneration(supabase, reservation.id, { status: "failed", provider: result.provider });
    return NextResponse.json(
      { error, needsKey: !reason, generationFailed: !!reason, engineMode: result.engineMode },
      { status: 422 }
    );
  }

  // Imagens custom: troca marcadores ADIMG: por fotos geradas por IA (não bloqueia
  // a geração se algo falhar — degrada para fallback).
  let imagesGenerated = 0;
  const msLeft = IMG_CEIL_MS - (Date.now() - started);
  if (result.engineMode === "real" && result.app && msLeft > 8_000) {
    // Ainda há tempo dentro da janela de ~60s: gera imagem por IA, mas com
    // orçamento de tempo — nunca deixa a soma passar do limite da Vercel.
    try {
      const orKey =
        userProvider === "openrouter" && typeof userKey === "string" && userKey
          ? userKey
          : process.env.OPENROUTER_API_KEY || null;
      imagesGenerated = await resolveAiImages(result.app, imageStorage, {
        userKey: orKey,
        userProvider: orKey ? "openrouter" : null,
        projectId,
        budgetMs: msLeft - 4_000,
      });
    } catch {
      /* imagem é opcional — nunca derruba a geração */
    }
  } else if (result.engineMode === "real" && result.app) {
    // Sem tempo para IA: troca os marcadores ADIMG por fallback na hora (instantâneo),
    // pra nunca sobrar "ADIMG:" cru na tela.
    try {
      await resolveAiImages(result.app, imageStorage, { userKey: null, userProvider: null, projectId });
    } catch {
      /* idem */
    }
  }
  if (imagesGenerated > 0) result.cost = (result.cost ?? 0) + imagesGenerated * 0.03; // custo estimado/imagem

  await finalizeGeneration(supabase, reservation.id, { status: "completed", provider: result.provider, cost: result.cost ?? 0, model: result.model ?? null });

  // custo acumulado do projeto
  const { data: rows } = await supabase.from("generations").select("cost_usd").eq("project_id", projectId);
  const projectCost = (rows ?? []).reduce((s: number, r: any) => s + Number(r.cost_usd ?? 0), 0);

  return NextResponse.json({ ...result, projectCost, imagesGenerated });
}
