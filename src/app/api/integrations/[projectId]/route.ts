import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authorizeProjectOwner, isUuid } from "@/lib/engine/data-guard";
import {
  createStripeCheckoutSession,
  dispatchAutomationWebhook,
  integrationStatuses,
} from "@/lib/integrations/commercial";

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
  return { user };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const context = await ownerContext(projectId);
  if (context.response) return context.response;
  return NextResponse.json({ integrations: integrationStatuses() });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const context = await ownerContext(projectId);
  if (context.response) return context.response;

  let body: any;
  try { body = await req.json(); } catch { return bad("Corpo inválido."); }

  try {
    if (body?.action === "stripe.checkout") {
      const session = await createStripeCheckoutSession({
        projectId,
        priceId: String(body.priceId || ""),
        successUrl: String(body.successUrl || ""),
        cancelUrl: String(body.cancelUrl || ""),
        customerEmail: typeof body.customerEmail === "string" ? body.customerEmail : undefined,
      });
      return NextResponse.json({ ok: true, checkout: session });
    }

    if (body?.action === "automation.dispatch") {
      const target = String(body.target || "");
      await dispatchAutomationWebhook(target, {
        projectId,
        event: typeof body.event === "string" ? body.event.slice(0, 120) : "manual",
        data: body.data ?? null,
        sentAt: new Date().toISOString(),
      });
      return NextResponse.json({ ok: true });
    }

    return bad("Ação de integração inválida.");
  } catch (error: any) {
    return bad(String(error?.message || error), 422);
  }
}
