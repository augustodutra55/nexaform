import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeProjectOwner, isUuid } from "@/lib/engine/data-guard";
import {
  createStripeCheckoutSession,
  dispatchAutomationWebhook,
} from "@/lib/integrations/commercial";
import {
  getProjectIntegration,
  projectIntegrationStatuses,
  removeProjectIntegration,
  saveProjectIntegration,
  type ProjectIntegrationProvider,
} from "@/lib/integrations/project-secrets";

export const runtime = "nodejs";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

async function ownerContext(projectId: string) {
  if (!isUuid(projectId)) return { response: bad("projectId inválido.") };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: bad("Não autenticado.", 401) };
  const access = await authorizeProjectOwner(supabase, projectId, user.id, false);
  if (!access.allowed) return { response: bad(access.error || "Acesso negado.", access.status || 403) };
  const admin = createAdminClient();
  if (!admin) return { response: bad("Cofre de integrações indisponível.", 503) };
  return { user, admin };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const context = await ownerContext(projectId);
  if (context.response) return context.response;
  try {
    const { data: project } = await context.admin!.from("projects").select("meta").eq("id", projectId).maybeSingle();
    const inbound = Array.isArray(project?.meta?.backendProvisioning?.inbound)
      ? project.meta.backendProvisioning.inbound.filter((item: any) => typeof item?.name === "string" && typeof item?.collection === "string")
      : [];
    return NextResponse.json({ integrations: await projectIntegrationStatuses(context.admin!, projectId), inbound });
  } catch (error: any) {
    return bad(String(error?.message || error), 500);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const context = await ownerContext(projectId);
  if (context.response) return context.response;

  let body: any;
  try { body = await req.json(); } catch { return bad("Corpo inválido."); }

  try {
    if (body?.action === "secret.save" || body?.action === "secret.remove") {
      const provider = String(body.provider || "") as ProjectIntegrationProvider;
      if (!["stripe", "resend", "automation", "inbound"].includes(provider)) return bad("Provedor inválido.");
      if (body.action === "secret.remove") {
        await removeProjectIntegration(context.admin!, projectId, provider);
        return NextResponse.json({ ok: true, integrations: await projectIntegrationStatuses(context.admin!, projectId) });
      }
      await saveProjectIntegration(context.admin!, projectId, provider, body.config);
      return NextResponse.json({ ok: true, integrations: await projectIntegrationStatuses(context.admin!, projectId) });
    }

    if (body?.action === "inbound.rotate") {
      const secret = randomBytes(32).toString("base64url");
      await saveProjectIntegration(context.admin!, projectId, "inbound", { secret });
      return NextResponse.json({
        ok: true,
        secret,
        integrations: await projectIntegrationStatuses(context.admin!, projectId),
      });
    }

    if (body?.action === "stripe.checkout") {
      const projectStripe = await getProjectIntegration<{ provider: "stripe"; secretKey: string }>(context.admin!, projectId, "stripe");
      const session = await createStripeCheckoutSession({
        projectId,
        priceId: String(body.priceId || ""),
        successUrl: String(body.successUrl || ""),
        cancelUrl: String(body.cancelUrl || ""),
        customerEmail: typeof body.customerEmail === "string" ? body.customerEmail : undefined,
      }, projectStripe?.secretKey);
      return NextResponse.json({ ok: true, checkout: session });
    }

    if (body?.action === "automation.dispatch") {
      const projectAutomation = await getProjectIntegration<{ provider: "automation"; targets: string[] }>(context.admin!, projectId, "automation");
      const target = String(body.target || "");
      await dispatchAutomationWebhook(target, {
        projectId,
        event: typeof body.event === "string" ? body.event.slice(0, 120) : "manual",
        data: body.data ?? null,
        sentAt: new Date().toISOString(),
      }, projectAutomation?.targets);
      return NextResponse.json({ ok: true });
    }

    return bad("Ação de integração inválida.");
  } catch (error: any) {
    return bad(String(error?.message || error), 422);
  }
}
