import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwner } from "@/lib/access";
import { authorizeProjectOwner, consumeRateLimit, isUuid, requestRateKey } from "@/lib/engine/data-guard";

const BUCKET = "app-uploads";
const MAX_BYTES = 50 * 1024 * 1024;
const TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/** Cria uma URL assinada para upload direto ao Supabase (sem passar o vídeo pela Vercel). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return bad("projectId inválido");
  if (!(await consumeRateLimit(`media-upload:${projectId}:${requestRateKey(req)}`, 30, 10 * 60_000))) {
    return bad("Muitos uploads em pouco tempo. Aguarde.", 429);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return bad("Não autenticado.", 401);

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const access = await authorizeProjectOwner(supabase, projectId, user.id, isOwner({ role: profile?.role, email: user.email }));
  if (!access.allowed) return bad(access.error || "Acesso negado.", access.status || 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Corpo inválido.");
  }
  const type = String(body?.type || "").toLowerCase();
  const size = Number(body?.size || 0);
  const name = String(body?.name || "mídia").slice(0, 180);
  const extension = TYPES[type];
  if (!extension) return bad("Formato não permitido. Use PNG, JPG, WebP, GIF, MP4, WebM ou MOV.", 415);
  if (!Number.isFinite(size) || size < 1 || size > MAX_BYTES) return bad("O arquivo deve ter no máximo 50 MB.", 413);

  const admin = createAdminClient();
  if (!admin) return bad("Backend de mídia não configurado.", 501);
  const path = `${projectId}/media-${crypto.randomUUID()}.${extension}`;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) return bad(error?.message || "Não foi possível preparar o upload.", 500);
  const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  return NextResponse.json({ path, token: data.token, publicUrl, name, type, size });
}
