import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateAppWithProviders } from "@/lib/engine/code-providers";
import { checkRateLimit } from "@/lib/engine/providers";
import { isOwner, resolvePlan } from "@/lib/access";
import type { AppCode } from "@/lib/engine/app-types";

// Apps grandes + auto-cura (retry/fallback) podem passar de 2 min; damos folga
// para o servidor não cortar a resposta no meio (o que virava "não é JSON válido").
export const maxDuration = 300;

// ---- Geração de imagens custom (Nano Banana / Gemini Flash Image via OpenRouter) ----
// O motor pode emitir marcadores  src="ADIMG: descrição em inglês"  onde quiser uma
// foto sob medida. Aqui, PÓS-geração, trocamos cada marcador por uma imagem gerada
// por IA e guardada no bucket público. Sem chave OpenRouter (ou em qualquer falha),
// cai num fallback que sempre carrega — nunca deixamos "ADIMG:" cru na tela nem
// quebramos a build.
const IMAGE_MODEL = process.env.NEXT_PUBLIC_IMAGE_MODEL || "google/gemini-2.5-flash-image";
const IMG_BUCKET = "app-uploads";
const MAX_IMAGES = 3; // teto por geração (controle de custo e de tempo)
const IMG_MARKER = /ADIMG:\s*([^"'`)\n]+)/g;

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
  const seed = (prompt || "clinic").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "clinic";
  return `https://picsum.photos/seed/${seed}/1200/800`;
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
  if (!texts.some((t) => new RegExp(IMG_MARKER.source).test(t))) return 0;

  const map = new Map<string, string>();
  if (opts.userKey && opts.userProvider === "openrouter") {
    const prompts: string[] = [];
    for (const t of texts) {
      const re = new RegExp(IMG_MARKER.source, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(t))) {
        const p = m[1].trim();
        if (p && !prompts.includes(p) && prompts.length < MAX_IMAGES) prompts.push(p);
      }
    }
    // Em paralelo: assim N imagens custam ~o tempo de UMA, não a soma — o que
    // evitava estourar o tempo do servidor (erro "não é JSON válido").
    await Promise.all(
      prompts.map(async (p) => {
        const dataUrl = await genImage(opts.userKey!, p, Math.min(18_000, Math.max(4_000, opts.budgetMs ?? 18_000)));
        const url = dataUrl ? await storeImage(supabase, opts.projectId, dataUrl) : null;
        map.set(p, url || imgFallback(p));
      })
    );
  }
  const swap = (t: string) =>
    t.replace(new RegExp(IMG_MARKER.source, "g"), (_m, p) => map.get(String(p).trim()) || imgFallback(String(p)));
  if (Array.isArray(app.files)) app.files = app.files.map((f) => ({ ...f, content: swap(f.content) }));
  if (typeof app.code === "string") app.code = swap(app.code);
  return Array.from(map.values()).filter((u) => u && !u.includes("picsum")).length;
}
// ---- fim da geração de imagens custom ----

export async function POST(req: NextRequest) {
  const started = Date.now();
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const owner = isOwner({ role: profile?.role, email: user.email });

  if (!owner && !checkRateLimit(user.id)) {
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

  // limite mensal (owner ignora)
  if (!owner) {
    const { data: sub } = await supabase.from("subscriptions").select("plan").eq("user_id", user.id).maybeSingle();
    const plan = resolvePlan({ plan: sub?.plan, role: profile?.role, email: user.email });
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from("generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", monthStart.toISOString());
    if ((count ?? 0) >= plan.maxGenerationsPerMonth) {
      return NextResponse.json(
        { error: `Limite de ${plan.maxGenerationsPerMonth} gerações do plano ${plan.name} atingido este mês.`, limitReached: true },
        { status: 402 }
      );
    }
  }

  // No plano Hobby da Vercel a função é cortada em ~60s (o maxDuration=300 é
  // IGNORADO nesse plano). Se a geração passar disso, a Vercel devolve uma página
  // de erro crua ("An error occurred") que o cliente não consegue ler como JSON.
  // Então cortamos NÓS em 50s e devolvemos um aviso claro em JSON.
  const DEADLINE = { __timeout: true as const };
  const raced = await Promise.race([
    generateAppWithProviders({
      message,
      currentCode: typeof currentCode === "string" ? currentCode : null,
      currentFiles: Array.isArray(currentFiles) ? currentFiles : null,
      name: typeof name === "string" ? name : "App",
      userKey: typeof userKey === "string" ? userKey : null,
      userProvider: userProvider ?? null,
      costMode: costMode ?? "auto",
      forceReal: forceReal !== false, // padrão: geração REAL
      allowTemplate: allowTemplate === true,
    }),
    new Promise<typeof DEADLINE>((resolve) => setTimeout(() => resolve(DEADLINE), 50_000)),
  ]);
  if ((raced as any).__timeout) {
    return NextResponse.json(
      {
        error:
          "A geração passou de ~50s. No plano atual da Vercel (Hobby) o servidor corta a função em ~60s, então parei antes para te avisar com clareza em vez de um erro quebrado. Tente um pedido menor, use o modo Econômico, ou ative o plano Pro da Vercel (libera até 5 min) para gerações grandes.",
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
    return NextResponse.json(
      { error, needsKey: !reason, generationFailed: !!reason, engineMode: result.engineMode },
      { status: 422 }
    );
  }

  // Imagens custom: troca marcadores ADIMG: por fotos geradas por IA (não bloqueia
  // a geração se algo falhar — degrada para fallback).
  let imagesGenerated = 0;
  const msLeft = 58_000 - (Date.now() - started);
  if (result.engineMode === "real" && result.app && msLeft > 8_000) {
    // Ainda há tempo dentro da janela de ~60s: gera imagem por IA, mas com
    // orçamento de tempo — nunca deixa a soma passar do limite da Vercel.
    try {
      imagesGenerated = await resolveAiImages(result.app, supabase, {
        userKey: typeof userKey === "string" ? userKey : null,
        userProvider: userProvider ?? null,
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
      await resolveAiImages(result.app, supabase, { userKey: null, userProvider: null, projectId });
    } catch {
      /* idem */
    }
  }
  if (imagesGenerated > 0) result.cost = (result.cost ?? 0) + imagesGenerated * 0.03; // custo estimado/imagem

  await supabase.from("generations").insert({
    user_id: user.id,
    project_id: projectId,
    prompt: message.slice(0, 2000),
    provider: result.provider,
    status: "completed",
    cost_usd: result.cost ?? 0,
    model: result.model ?? null,
  });

  // custo acumulado do projeto
  const { data: rows } = await supabase.from("generations").select("cost_usd").eq("project_id", projectId);
  const projectCost = (rows ?? []).reduce((s: number, r: any) => s + Number(r.cost_usd ?? 0), 0);

  return NextResponse.json({ ...result, projectCost, imagesGenerated });
}
