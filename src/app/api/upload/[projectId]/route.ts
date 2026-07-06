import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authorizeProject, rateLimit } from "@/lib/engine/data-guard";

/**
 * Upload de arquivos dos apps gerados. Recebe um arquivo (multipart ou base64),
 * salva no bucket público "app-uploads" sob o prefixo do projeto e devolve a URL
 * pública. Escopado e limitado (tamanho/tipo) — chamado por window.AD.upload.
 */

const BUCKET = "app-uploads";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const OK_TYPES = /^(image\/(png|jpe?g|gif|webp|svg\+xml)|application\/pdf|text\/plain)$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ext(name: string, type: string): string {
  const fromName = (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] || "").toLowerCase();
  if (fromName) return fromName;
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "application/pdf": "pdf",
    "text/plain": "txt",
  };
  return map[type] || "bin";
}

export async function POST(req: NextRequest, { params }: { params: { projectId: string } }) {
  const projectId = params.projectId;
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: "projectId inválido" }, { status: 400 });
  if (!rateLimit(`upload:${projectId}`, 30)) return NextResponse.json({ error: "Muitos uploads em pouco tempo. Aguarde." }, { status: 429 });

  let bytes: Buffer;
  let contentType = "application/octet-stream";
  let name = "arquivo";

  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "Arquivo ausente" }, { status: 400 });
      contentType = file.type || contentType;
      name = file.name || name;
      bytes = Buffer.from(await file.arrayBuffer());
    } else {
      // JSON: { name, type, dataBase64 }
      const body = await req.json();
      const b64 = String(body?.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
      if (!b64) return NextResponse.json({ error: "dataBase64 ausente" }, { status: 400 });
      contentType = String(body?.type || contentType);
      name = String(body?.name || name);
      bytes = Buffer.from(b64, "base64");
    }
  } catch {
    return NextResponse.json({ error: "Corpo inválido" }, { status: 400 });
  }

  if (bytes.length > MAX_BYTES) return NextResponse.json({ error: "Arquivo maior que 5MB" }, { status: 413 });
  if (!OK_TYPES.test(contentType))
    return NextResponse.json({ error: `Tipo não permitido: ${contentType}` }, { status: 415 });

  const supabase = createClient();
  const g = await authorizeProject(supabase, projectId, "write");
  if (!g.allowed) return NextResponse.json({ error: g.error }, { status: g.status });

  const path = `${projectId}/${crypto.randomUUID()}.${ext(name, contentType)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl, path });
}
