import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authorizeProject, rateLimit } from "@/lib/engine/data-guard";

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

// Nome de campo seguro para montar caminhos JSONB (data->>campo) sem injeção.
const FIELD_RE = /^[a-zA-Z0-9_]+$/;
/** Aplica filtros de igualdade vindos de ?where={"campo":valor,...} sobre o JSONB. */
function applyWhere(q: any, whereRaw: string | null) {
  if (!whereRaw) return q;
  try {
    const where = JSON.parse(whereRaw);
    if (where && typeof where === "object" && !Array.isArray(where)) {
      for (const [k, v] of Object.entries(where)) {
        if (!FIELD_RE.test(k) || v == null) continue;
        q = q.eq(`data->>${k}`, String(v));
      }
    }
  } catch {
    /* where inválido → ignora */
  }
  return q;
}

/**
 * GET — consulta a coleção. Suporta:
 *   ?collection=nome            (padrão "default")
 *   ?id=UUID                    → devolve { item } (um registro) ou null
 *   ?count=1                    → devolve { count } (aplica os filtros)
 *   ?where={"campo":"valor"}    → filtros de igualdade (JSONB)
 *   ?search=termo&searchField=campo → busca textual (ilike) num campo
 *   ?sort=campo | ?sort=-campo  → ordena asc/desc (use _createdAt para data)
 *   ?limit=N&offset=M           → paginação (limit até 1000)
 */
export async function GET(req: NextRequest, { params }: { params: { projectId: string } }) {
  const projectId = params.projectId;
  if (!UUID_RE.test(projectId)) return bad("projectId inválido");
  const sp = req.nextUrl.searchParams;
  const collection = sp.get("collection") || "default";
  const supabase = createClient();
  const g = await authorizeProject(supabase, projectId, "read");
  if (!g.allowed) return NextResponse.json({ error: g.error }, { status: g.status });

  // Contagem (com filtros): ?count=1
  if (sp.get("count")) {
    let cq = supabase
      .from("app_data")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("collection", collection);
    cq = applyWhere(cq, sp.get("where"));
    const { count, error } = await cq;
    if (error) return bad(error.message, 500);
    return NextResponse.json({ count: count ?? 0 });
  }

  // Um registro por id: ?id=UUID
  const oneId = sp.get("id");
  if (oneId) {
    const { data, error } = await supabase
      .from("app_data")
      .select("id, data, created_at")
      .eq("project_id", projectId)
      .eq("collection", collection)
      .eq("id", oneId)
      .maybeSingle();
    if (error) return bad(error.message, 500);
    return NextResponse.json({ item: data ? shape(data) : null });
  }

  // Listagem com filtros/busca/ordenação/paginação.
  let q = supabase
    .from("app_data")
    .select("id, data, created_at")
    .eq("project_id", projectId)
    .eq("collection", collection);
  q = applyWhere(q, sp.get("where"));

  const search = sp.get("search");
  const searchField = sp.get("searchField");
  if (search && searchField && FIELD_RE.test(searchField)) {
    q = q.ilike(`data->>${searchField}`, `%${search.slice(0, 100)}%`);
  }

  const sort = sp.get("sort");
  if (sort) {
    const desc = sort.startsWith("-");
    const field = desc ? sort.slice(1) : sort;
    if (field === "_createdAt" || field === "created_at") {
      q = q.order("created_at", { ascending: !desc });
    } else if (FIELD_RE.test(field)) {
      q = q.order(`data->>${field}`, { ascending: !desc });
    }
  } else {
    q = q.order("created_at", { ascending: true });
  }

  const limit = Math.min(parseInt(sp.get("limit") || "", 10) || LIST_LIMIT, LIST_LIMIT);
  const offset = Math.max(parseInt(sp.get("offset") || "", 10) || 0, 0);
  q = q.range(offset, offset + limit - 1);

  const { data, error } = await q;
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
  if (!rateLimit(`data:${projectId}`)) return bad("Muitas gravações em pouco tempo. Aguarde.", 429);

  const supabase = createClient();
  const g = await authorizeProject(supabase, projectId, "write");
  if (!g.allowed) return NextResponse.json({ error: g.error }, { status: g.status });
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
  if (!rateLimit(`data:${projectId}`)) return bad("Muitas gravações em pouco tempo. Aguarde.", 429);

  const supabase = createClient();
  const g = await authorizeProject(supabase, projectId, "write");
  if (!g.allowed) return NextResponse.json({ error: g.error }, { status: g.status });
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
  if (!rateLimit(`data:${projectId}`)) return bad("Muitas operações em pouco tempo. Aguarde.", 429);
  const supabase = createClient();
  const g = await authorizeProject(supabase, projectId, "write");
  if (!g.allowed) return NextResponse.json({ error: g.error }, { status: g.status });
  const { error } = await supabase.from("app_data").delete().eq("project_id", projectId).eq("id", id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
