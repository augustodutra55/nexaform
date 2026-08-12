import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authorizeProjectOwner, isUuid } from "@/lib/engine/data-guard";
import { isOwner } from "@/lib/access";
import { readMeta } from "@/lib/studio";
import {
  normalizeCustomDomain,
  snapshotFromVercelDomain,
  vercelAddProjectDomainUrl,
  vercelDomainConfigFromEnv,
  vercelDomainRequest,
  vercelProjectDomainUrl,
  type CustomDomainSnapshot,
} from "@/lib/delivery/custom-domain";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

async function projectContext(projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: jsonError("Não autenticado.", 401) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const access = await authorizeProjectOwner(
    supabase,
    projectId,
    user.id,
    isOwner({ role: profile?.role, email: user.email })
  );
  if (!access.allowed) return { response: jsonError(access.error || "Acesso negado.", access.status || 403) };
  const { data: project, error } = await supabase
    .from("projects")
    .select("id, published, share_slug, meta")
    .eq("id", projectId)
    .maybeSingle();
  if (error) return { response: jsonError(error.message, 500) };
  if (!project) return { response: jsonError("Projeto não encontrado.", 404) };
  return { supabase, project };
}

async function persistDomain(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  currentMeta: unknown,
  snapshot: CustomDomainSnapshot | null
) {
  const meta = readMeta(currentMeta);
  const delivery = { ...(meta.delivery || {}) } as any;
  if (snapshot) {
    delivery.customDomain = snapshot.name;
    delivery.customDomainStatus = snapshot;
  } else {
    delete delivery.customDomain;
    delete delivery.customDomainStatus;
  }
  const nextMeta = { ...meta, delivery };
  const { error } = await supabase
    .from("projects")
    .update({ meta: nextMeta, updated_at: new Date().toISOString() })
    .eq("id", projectId);
  if (error) throw new Error(error.message);
  return nextMeta;
}

function currentDomain(project: { meta: unknown }): string | null {
  const meta = readMeta(project.meta);
  const value = meta.delivery?.customDomain;
  return typeof value === "string" && value ? value : null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return jsonError("projectId inválido.");
  const resolved = await projectContext(projectId);
  if (resolved.response) return resolved.response;
  const domain = currentDomain(resolved.project!);
  const stored = readMeta(resolved.project!.meta).delivery?.customDomainStatus || null;
  const config = vercelDomainConfigFromEnv();
  if (!domain || !config) {
    return NextResponse.json({ domain, status: stored, integrationConfigured: !!config });
  }
  try {
    const payload = await vercelDomainRequest(config, vercelProjectDomainUrl(config, domain));
    const status = snapshotFromVercelDomain(payload, domain);
    await persistDomain(resolved.supabase!, projectId, resolved.project!.meta, status);
    return NextResponse.json({ domain, status, integrationConfigured: true });
  } catch (error: any) {
    return NextResponse.json({
      domain,
      status: stored,
      integrationConfigured: true,
      remoteError: error?.message || "Não foi possível consultar o domínio na Vercel.",
    });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return jsonError("projectId inválido.");
  const resolved = await projectContext(projectId);
  if (resolved.response) return resolved.response;
  if (!resolved.project!.published) return jsonError("Publique o projeto antes de conectar um domínio personalizado.", 409);
  const config = vercelDomainConfigFromEnv();
  if (!config) return jsonError("Integração de domínio não configurada no servidor.", 501);

  let body: { action?: "attach" | "verify" | "refresh"; domain?: string } = {};
  try { body = await req.json(); } catch {}
  const action = body.action || "attach";
  let domain: string;
  try {
    domain = normalizeCustomDomain(body.domain || currentDomain(resolved.project!) || "");
  } catch (error: any) {
    return jsonError(error?.message || "Domínio inválido.");
  }

  try {
    let payload: any;
    if (action === "attach") {
      payload = await vercelDomainRequest(config, vercelAddProjectDomainUrl(config), {
        method: "POST",
        body: JSON.stringify({ name: domain }),
      });
    } else if (action === "verify") {
      payload = await vercelDomainRequest(config, vercelProjectDomainUrl(config, domain, "verify"), { method: "POST" });
    } else if (action === "refresh") {
      payload = await vercelDomainRequest(config, vercelProjectDomainUrl(config, domain));
    } else {
      return jsonError("Ação de domínio inválida.");
    }
    const status = snapshotFromVercelDomain(payload, domain);
    const meta = await persistDomain(resolved.supabase!, projectId, resolved.project!.meta, status);
    return NextResponse.json({ domain, status, meta });
  } catch (error: any) {
    return jsonError(error?.message || "Não foi possível configurar o domínio.", error?.status || 502);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return jsonError("projectId inválido.");
  const resolved = await projectContext(projectId);
  if (resolved.response) return resolved.response;
  const config = vercelDomainConfigFromEnv();
  if (!config) return jsonError("Integração de domínio não configurada no servidor.", 501);
  let requestedDomain = currentDomain(resolved.project!);
  try {
    const body = await req.json();
    if (body?.domain) requestedDomain = body.domain;
  } catch {}
  if (!requestedDomain) return jsonError("O projeto não possui domínio personalizado.", 404);
  let domain: string;
  try { domain = normalizeCustomDomain(requestedDomain); } catch (error: any) { return jsonError(error?.message || "Domínio inválido."); }

  try {
    await vercelDomainRequest(config, vercelProjectDomainUrl(config, domain), { method: "DELETE" });
    const meta = await persistDomain(resolved.supabase!, projectId, resolved.project!.meta, null);
    return NextResponse.json({ removed: true, domain, meta });
  } catch (error: any) {
    return jsonError(error?.message || "Não foi possível remover o domínio.", error?.status || 502);
  }
}
