import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwner } from "@/lib/access";
import { authorizeProjectOwner, consumeRateLimit, isUuid, requestRateKey } from "@/lib/engine/data-guard";
import { generateAiImage, storeAiImage } from "@/lib/media/ai-image";

/**
 * Gera uma imagem por IA (Nano Banana / Gemini 2.5 Flash Image) a partir de um
 * prompt e guarda no bucket do projeto, devolvendo a URL pública. Assim o criador
 * gera a foto direto na aba Mídia, sem sair do AD Studio.
 *
 * POST /api/media-generate/[projectId]
 * Body: { prompt: string, userKey?: string, userProvider?: string }
 */
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return NextResponse.json({ error: "projectId inválido." }, { status: 400 });

  if (!(await consumeRateLimit(`media-generate:${projectId}:${requestRateKey(req)}`, 20, 10 * 60_000))) {
    return NextResponse.json({ error: "Muitas gerações de imagem em pouco tempo. Aguarde." }, { status: 429 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const access = await authorizeProjectOwner(supabase, projectId, user.id, isOwner({ role: profile?.role, email: user.email }));
  if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status ?? 403 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 600) : "";
  if (!prompt) return NextResponse.json({ error: "Descreva a imagem que você quer gerar." }, { status: 400 });

  const userKey = typeof body?.userKey === "string" ? body.userKey : "";
  const userProvider = typeof body?.userProvider === "string" ? body.userProvider : "";
  const apiKey = userProvider === "openrouter" && userKey ? userKey : process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Configure sua chave do OpenRouter em Configurações para gerar imagens." },
      { status: 400 }
    );
  }

  const dataUrl = await generateAiImage(apiKey, prompt);
  if (!dataUrl) {
    return NextResponse.json(
      { error: "A imagem não pôde ser gerada agora. Tente de novo ou ajuste a descrição." },
      { status: 502 }
    );
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Armazenamento indisponível." }, { status: 503 });
  const url = await storeAiImage(admin, projectId, dataUrl);
  if (!url) {
    return NextResponse.json({ error: "A imagem foi gerada, mas não pôde ser salva." }, { status: 502 });
  }

  return NextResponse.json({ url });
}
