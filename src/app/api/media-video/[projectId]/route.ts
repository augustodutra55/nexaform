import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwner } from "@/lib/access";
import { authorizeProjectOwner, consumeRateLimit, isUuid, requestRateKey } from "@/lib/engine/data-guard";

export const runtime = "nodejs";
export const maxDuration = 90;

const OPENROUTER = "https://openrouter.ai/api/v1/videos";
const VIDEO_MODEL = process.env.OPENROUTER_VIDEO_MODEL || "google/veo-3.1";
const JOB_RE = /^[a-zA-Z0-9_-]{3,200}$/;

async function owner(req: NextRequest, projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const access = await authorizeProjectOwner(supabase, projectId, user.id, isOwner({ role: profile?.role, email: user.email }));
  if (!access.allowed) return { error: NextResponse.json({ error: access.error }, { status: access.status ?? 403 }) };
  return {};
}

async function storeVideo(projectId: string, apiKey: string, jobId: string) {
  const response = await fetch(`${OPENROUTER}/${encodeURIComponent(jobId)}/content?index=0`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(75_000),
  });
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1_000 || bytes.length > 50 * 1024 * 1024) return null;
  const admin = createAdminClient();
  if (!admin) return null;
  const path = `${projectId}/ai-video-${crypto.randomUUID()}.mp4`;
  const { error } = await admin.storage.from("app-uploads").upload(path, bytes, { contentType: "video/mp4", upsert: false });
  if (error) return null;
  return admin.storage.from("app-uploads").getPublicUrl(path).data.publicUrl as string;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return NextResponse.json({ error: "projectId inválido." }, { status: 400 });
  const ownership = await owner(req, projectId);
  if (ownership.error) return ownership.error;
  const body = await req.json().catch(() => null);
  const action = body?.action === "status" ? "status" : "submit";
  const limit = action === "submit" ? 5 : 120;
  if (!(await consumeRateLimit(`media-video:${action}:${projectId}:${requestRateKey(req)}`, limit, 60 * 60_000))) {
    return NextResponse.json({ error: "Limite temporário de vídeo atingido. Aguarde." }, { status: 429 });
  }
  const userKey = typeof body?.userKey === "string" ? body.userKey : "";
  const apiKey = body?.userProvider === "openrouter" && userKey ? userKey : process.env.OPENROUTER_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Configure uma chave OpenRouter para gerar vídeo." }, { status: 400 });

  if (action === "status") {
    const jobId = typeof body?.jobId === "string" ? body.jobId : "";
    if (!JOB_RE.test(jobId)) return NextResponse.json({ error: "Job de vídeo inválido." }, { status: 400 });
    const response = await fetch(`${OPENROUTER}/${encodeURIComponent(jobId)}`, { headers: { authorization: `Bearer ${apiKey}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ error: data?.error?.message || data?.error || "Falha ao consultar o vídeo." }, { status: response.status });
    if (data.status === "completed") {
      const url = await storeVideo(projectId, apiKey, jobId);
      if (!url) return NextResponse.json({ error: "O vídeo ficou pronto, mas não pôde ser salvo." }, { status: 502 });
      return NextResponse.json({ status: "completed", url, usage: data.usage || null });
    }
    return NextResponse.json({ status: data.status, error: data.error || null });
  }

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 1200) : "";
  if (!prompt) return NextResponse.json({ error: "Descreva o vídeo que você quer gerar." }, { status: 400 });
  const response = await fetch(OPENROUTER, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: VIDEO_MODEL, prompt, duration: 4, resolution: "720p", aspect_ratio: "16:9", generate_audio: false }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return NextResponse.json({ error: data?.error?.message || data?.error || "Não foi possível iniciar o vídeo." }, { status: response.status });
  return NextResponse.json({ jobId: data.id, status: data.status || "pending" }, { status: 202 });
}
