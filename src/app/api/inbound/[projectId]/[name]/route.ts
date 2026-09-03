import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit, isUuid, requestRateKey } from "@/lib/engine/data-guard";
import { getProjectIntegration } from "@/lib/integrations/project-secrets";
import { normalizeInboundEvent } from "@/lib/integrations/inbound";

export const runtime = "nodejs";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function sameSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function stableEventId(projectId: string, endpoint: string, externalId: string): string {
  const hex = createHash("sha256").update(`${projectId}\0${endpoint}\0${externalId}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string; name: string }> }) {
  const { projectId, name } = await params;
  if (!isUuid(projectId) || !/^[a-z][a-z0-9_-]{0,59}$/.test(name)) return bad("Endpoint inválido.");
  if (!(await consumeRateLimit(`inbound:${projectId}:${name}:${requestRateKey(req)}`, 60, 10 * 60_000))) {
    return bad("Muitos eventos recebidos. Aguarde.", 429);
  }
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > 100_000) return bad("Evento excede o limite de 100 KB.", 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return bad("JSON inválido."); }

  const admin = createAdminClient();
  if (!admin) return bad("Backend indisponível.", 503);
  const { data: project, error } = await admin.from("projects")
    .select("id,published,meta")
    .eq("id", projectId)
    .eq("published", true)
    .maybeSingle();
  if (error) return bad("Não foi possível validar o projeto.", 500);
  if (!project) return bad("Projeto publicado não encontrado.", 404);
  const endpoints = Array.isArray(project.meta?.backendProvisioning?.inbound)
    ? project.meta.backendProvisioning.inbound
    : [];
  const endpoint = endpoints.find((item: any) => item?.name === name && typeof item?.collection === "string");
  if (!endpoint) return bad("Endpoint não declarado pelo aplicativo.", 404);

  let config;
  try {
    config = await getProjectIntegration<{ provider: "inbound"; secret: string }>(admin, projectId, "inbound");
  } catch {
    return bad("Entrada externa ainda não foi configurada.", 503);
  }
  const supplied = req.headers.get("x-adstudio-secret") || "";
  if (!config || !sameSecret(supplied, config.secret)) return bad("Segredo de webhook inválido.", 401);

  let event;
  try { event = normalizeInboundEvent(body); } catch (reason) {
    return bad(reason instanceof Error ? reason.message : "Evento inválido.");
  }
  const eventId = stableEventId(projectId, name, event.externalId);
  const { data: record, error: insertError } = await admin.from("app_data")
    .insert({ id: eventId, project_id: projectId, collection: endpoint.collection, data: event })
    .select("id")
    .single();
  if (insertError?.code === "23505") return NextResponse.json({ ok: true, duplicate: true, id: eventId });
  if (insertError) return bad("Não foi possível registrar o evento.", 500);
  return NextResponse.json({ ok: true, duplicate: false, id: record.id, status: event.status }, { status: 201 });
}
