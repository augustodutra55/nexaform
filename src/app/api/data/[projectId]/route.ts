import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit, isUuid, requestRateKey } from "@/lib/engine/data-guard";
import {
  authorizeCollectionOperation,
  isCollectionName,
  type CollectionAccess,
} from "@/lib/engine/collection-access";

/**
 * Backend de dados embutido dos apps gerados. A service role toca app_data
 * somente depois de validar projeto, coleção, operação e identidade do ator.
 */

const MAX_BYTES = 100_000;
const MAX_ROWS_PER_PROJECT = 5000;
const LIST_LIMIT = 1000;

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}
function shape(row: any) {
  return { id: row.id, ...(row.data ?? {}), _createdAt: row.created_at };
}
function denied(access: CollectionAccess) {
  return NextResponse.json({ error: access.error }, { status: access.status ?? 403 });
}
function scoped(q: any, access: CollectionAccess) {
  return access.scopeToAppUser ? q.eq("app_user_id", access.appUserId) : q;
}

const FIELD_RE = /^[a-zA-Z0-9_]+$/;
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
    /* filtro inválido é ignorado */
  }
  return q;
}

function collectionFrom(value: unknown): string | null {
  if (typeof value !== "string" || !isCollectionName(value)) return null;
  return value;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return bad("projectId inválido");
  const sp = req.nextUrl.searchParams;
  const collection = collectionFrom(sp.get("collection") || "default");
  if (!collection) return bad("Nome de coleção inválido.");

  const admin = createAdminClient();
  if (!admin) return bad("Backend de dados não configurado.", 501);
  const access = await authorizeCollectionOperation(req, await createClient(), admin, projectId, collection, "read");
  if (!access.allowed) return denied(access);

  if (sp.get("count")) {
    let q = admin
      .from("app_data")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("collection", collection);
    q = scoped(q, access);
    q = applyWhere(q, sp.get("where"));
    const { count, error } = await q;
    if (error) return bad(error.message, 500);
    return NextResponse.json({ count: count ?? 0 });
  }

  const oneId = sp.get("id");
  if (oneId) {
    if (!isUuid(oneId)) return bad("id inválido");
    let q = admin
      .from("app_data")
      .select("id, data, created_at")
      .eq("project_id", projectId)
      .eq("collection", collection)
      .eq("id", oneId);
    q = scoped(q, access);
    const { data, error } = await q.maybeSingle();
    if (error) return bad(error.message, 500);
    return NextResponse.json({ item: data ? shape(data) : null });
  }

  let q = admin
    .from("app_data")
    .select("id, data, created_at")
    .eq("project_id", projectId)
    .eq("collection", collection);
  q = scoped(q, access);
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

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return bad("projectId inválido");
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Corpo inválido");
  }
  const collection = collectionFrom(body?.collection ?? "default");
  if (!collection) return bad("Nome de coleção inválido.");
  const data = body?.data ?? {};
  if (typeof data !== "object" || Array.isArray(data)) return bad("data deve ser um objeto");
  if (JSON.stringify(data).length > MAX_BYTES) return bad("Registro grande demais", 413);
  if (!(await consumeRateLimit(`data:${projectId}:${requestRateKey(req)}`))) return bad("Muitas gravações em pouco tempo. Aguarde.", 429);

  const admin = createAdminClient();
  if (!admin) return bad("Backend de dados não configurado.", 501);
  const access = await authorizeCollectionOperation(req, await createClient(), admin, projectId, collection, "insert");
  if (!access.allowed) return denied(access);

  const { count } = await admin
    .from("app_data")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if ((count ?? 0) >= MAX_ROWS_PER_PROJECT) return bad("Limite de registros do projeto atingido", 429);

  const { data: row, error } = await admin
    .from("app_data")
    .insert({ project_id: projectId, collection, data, app_user_id: access.appUserId ?? null })
    .select("id, data, created_at")
    .single();
  if (error) return bad(error.message, 500);
  return NextResponse.json({ item: shape(row) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return bad("projectId inválido");
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Corpo inválido");
  }
  const id = body?.id;
  if (typeof id !== "string" || !isUuid(id)) return bad("id inválido");
  const data = body?.data ?? {};
  if (typeof data !== "object" || Array.isArray(data)) return bad("data deve ser um objeto");
  if (JSON.stringify(data).length > MAX_BYTES) return bad("Registro grande demais", 413);
  if (!(await consumeRateLimit(`data:${projectId}:${requestRateKey(req)}`))) return bad("Muitas gravações em pouco tempo. Aguarde.", 429);

  const admin = createAdminClient();
  if (!admin) return bad("Backend de dados não configurado.", 501);
  const { data: existing, error: existingError } = await admin
    .from("app_data")
    .select("id, collection, data, app_user_id")
    .eq("project_id", projectId)
    .eq("id", id)
    .maybeSingle();
  if (existingError) return bad(existingError.message, 500);
  if (!existing) return bad("Registro não encontrado.", 404);

  const access = await authorizeCollectionOperation(
    req,
    await createClient(),
    admin,
    projectId,
    existing.collection,
    "update"
  );
  if (!access.allowed) return denied(access);
  if (access.scopeToAppUser && existing.app_user_id !== access.appUserId) {
    return bad("Você só pode alterar seus próprios registros.", 403);
  }

  const finalData = body?.replace === true ? data : { ...(existing.data ?? {}), ...data };
  if (JSON.stringify(finalData).length > MAX_BYTES) return bad("Registro grande demais", 413);

  const { data: row, error } = await admin
    .from("app_data")
    .update({ data: finalData, updated_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("id", id)
    .select("id, data, created_at")
    .single();
  if (error) return bad(error.message, 500);
  return NextResponse.json({ item: shape(row) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return bad("projectId inválido");
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !isUuid(id)) return bad("id inválido");
  if (!(await consumeRateLimit(`data:${projectId}:${requestRateKey(req)}`))) return bad("Muitas operações em pouco tempo. Aguarde.", 429);

  const admin = createAdminClient();
  if (!admin) return bad("Backend de dados não configurado.", 501);
  const { data: existing, error: existingError } = await admin
    .from("app_data")
    .select("id, collection, app_user_id")
    .eq("project_id", projectId)
    .eq("id", id)
    .maybeSingle();
  if (existingError) return bad(existingError.message, 500);
  if (!existing) return bad("Registro não encontrado.", 404);

  const access = await authorizeCollectionOperation(
    req,
    await createClient(),
    admin,
    projectId,
    existing.collection,
    "delete"
  );
  if (!access.allowed) return denied(access);
  if (access.scopeToAppUser && existing.app_user_id !== access.appUserId) {
    return bad("Você só pode excluir seus próprios registros.", 403);
  }

  const { error } = await admin.from("app_data").delete().eq("project_id", projectId).eq("id", id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
