import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Backend de dados embutido dos apps gerados pelo AD Studio.
 * CRUD simples, escopado por project_id (na URL), sobre a tabela app_data.
 * Público (apps publicados não têm sessão), então há limites contra abuso.
 */

const MAX_BYTES = 100_000; // 100KB por registro
const MAX_ROWS_PER_PROJECT = 5000;
const LIST_LIMIT = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}
function shape(row: any) {
  // Conveniência: mescla o id com os campos guardados.
  return { id: row.id, ...(row.data ?? {}), _createdAt: row.created_at };
}

export async function GET(req: NextRequest, { params }: { params: { projectId: string } }) {
  const projectId = params.projectId;
  if (!UUID_RE.test(projectId)) return bad("projectId inválido");
  const collection = req.nextUrl.searchParams.get("collection") || "default";
  const supabase = createClient();
  const { data, error } = await supabase
    .from("app_data")
    .select("id, data, created_at")
    .eq("project_id", projectId)
    .eq("collection", collection)
    .order("created_at", { ascending: true })
    .limit(LIST_LIMIT);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ items: (data ?? []).map(shape) });
}

export async function POST(req: NextRequest, { params }: { params: { projectId: string } }) {
  const projectId = params.projectId;
  if (!UUID_RE.test(projectId)) return bad("projectId inválido");
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Corpo inválido");
  }
  const collection = typeof body?.collection === "string" ? body.collection.slice(0, 80) : "default";
  const data = body?.data ?? {};
  if (typeof data !== "object" || Array.isArray(data)) return bad("data deve ser um objeto");
  if (JSON.stringify(data).length > MAX_BYTES) return bad("Registro grande demais", 413);

  const supabase = createClient();
  const { count } = await supabase
    .from("app_data")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if ((count ?? 0) >= MAX_ROWS_PER_PROJECT) return bad("Limite de registros do projeto atingido", 429);

  const { data: row, error } = await supabase
    .from("app_data")
    .insert({ project_id: projectId, collection, data })
    .select("id, data, created_at")
    .single();
  if (error) return bad(error.message, 500);
  return NextResponse.json({ item: shape(row) });
}

export async function PATCH(req: NextRequest, { params }: { params: { projectId: string } }) {
  const projectId = params.projectId;
  if (!UUID_RE.test(projectId)) return bad("projectId inválido");
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Corpo inválido");
  }
  const id = body?.id;
  if (typeof id !== "string") return bad("id obrigatório");
  const data = body?.data ?? {};
  if (typeof data !== "object" || Array.isArray(data)) return bad("data deve ser um objeto");
  if (JSON.stringify(data).length > MAX_BYTES) return bad("Registro grande demais", 413);

  const supabase = createClient();
  const { data: row, error } = await supabase
    .from("app_data")
    .update({ data, updated_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("id", id)
    .select("id, data, created_at")
    .single();
  if (error) return bad(error.message, 500);
  return NextResponse.json({ item: shape(row) });
}

export async function DELETE(req: NextRequest, { params }: { params: { projectId: string } }) {
  const projectId = params.projectId;
  if (!UUID_RE.test(projectId)) return bad("projectId inválido");
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return bad("id obrigatório");
  const supabase = createClient();
  const { error } = await supabase.from("app_data").delete().eq("project_id", projectId).eq("id", id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
