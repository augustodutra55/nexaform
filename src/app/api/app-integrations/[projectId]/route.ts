import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit, isUuid, requestRateKey } from "@/lib/engine/data-guard";
import { createStripeCheckoutSession, dispatchAutomationWebhook } from "@/lib/integrations/commercial";
import { getProjectIntegration } from "@/lib/integrations/project-secrets";

export const runtime = "nodejs";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function publicBase(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    if (url.protocol === "https:") return url.origin;
  }
  return req.nextUrl.origin;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return bad("projectId inválido.");
  let body: any;
  try { body = await req.json(); } catch { return bad("Corpo inválido."); }

  const admin = createAdminClient();
  if (!admin) return bad("Integrações indisponíveis.", 503);
  const { data: project, error } = await admin
    .from("projects")
    .select("id,published,share_slug,meta")
    .eq("id", projectId)
    .eq("published", true)
    .maybeSingle();
  if (error) return bad("Não foi possível validar o projeto.", 500);
  if (!project?.share_slug) return bad("Projeto publicado não encontrado.", 404);

  if (body?.action === "backend.run") {
    if (!(await consumeRateLimit(`app-action:${projectId}:${requestRateKey(req)}`, 30, 10 * 60_000))) {
      return bad("Muitas execuções desta função. Aguarde um instante.", 429);
    }
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const actions = Array.isArray(project.meta?.backendProvisioning?.actions) ? project.meta.backendProvisioning.actions : [];
    const declared = actions.find((item: any) => item?.name === name);
    if (!declared || typeof declared.target !== "string") return bad("Função não autorizada para este aplicativo.", 403);
    const encoded = JSON.stringify(body?.data ?? null);
    if (encoded.length > 20_000) return bad("Dados da função excedem o limite.", 413);
    try {
      const integration = await getProjectIntegration<{ provider: "automation"; targets: string[] }>(admin, projectId, "automation");
      if (!integration) return bad("Configure o webhook desta função no cofre do projeto.", 422);
      await dispatchAutomationWebhook(declared.target, {
        projectId,
        action: name,
        data: body?.data ?? null,
        sentAt: new Date().toISOString(),
      }, integration.targets);
      return NextResponse.json({ ok: true, action: name });
    } catch (actionError: any) {
      return bad(String(actionError?.message || actionError), 422);
    }
  }

  if (body?.action !== "stripe.checkout") return bad("Ação de integração inválida.");
  if (!(await consumeRateLimit(`app-checkout:${projectId}:${requestRateKey(req)}`, 20, 10 * 60_000))) {
    return bad("Muitas tentativas de pagamento. Aguarde um instante.", 429);
  }
  const prices = project.meta?.backendProvisioning?.payments?.prices;
  const key = typeof body?.priceKey === "string" ? body.priceKey.trim() : "";
  const price = Array.isArray(prices) ? prices.find((item: any) => item?.key === key) : null;
  if (!price || typeof price.priceId !== "string") return bad("Preço não autorizado para este projeto.", 403);

  try {
    const projectStripe = await getProjectIntegration<{ provider: "stripe"; secretKey: string }>(admin, projectId, "stripe");
    const base = publicBase(req);
    const publishedUrl = `${base}/p/${encodeURIComponent(project.share_slug)}`;
    const checkout = await createStripeCheckoutSession({
      projectId,
      priceId: price.priceId,
      mode: price.mode === "subscription" ? "subscription" : "payment",
      successUrl: `${publishedUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${publishedUrl}?checkout=cancelled`,
      customerEmail: typeof body.customerEmail === "string" ? body.customerEmail : undefined,
    }, projectStripe?.secretKey);
    return NextResponse.json({ ok: true, checkout });
  } catch (checkoutError: any) {
    return bad(String(checkoutError?.message || checkoutError), 422);
  }
}
