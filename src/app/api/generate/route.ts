import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateWithProviders } from "@/lib/engine/providers";
import { isValidSchema } from "@/lib/engine/types";
import { isOwner, resolvePlan } from "@/lib/access";
import { authorizeProjectOwner, consumeRateLimit, isUuid } from "@/lib/engine/data-guard";
import { finalizeGeneration, reserveGeneration } from "@/lib/engine/generation-usage";
import { classifyGenerationFailure, safeOperationalMessage } from "@/lib/engine/observability";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const started = Date.now();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  // ── Owner bypass: role no banco ou email de env ──────────────
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const owner = isOwner({ role: profile?.role, email: user.email });

  if (!owner && !(await consumeRateLimit(`generation:${user.id}`, Number(process.env.GENERATION_RATE_LIMIT ?? 20), 60 * 60_000))) {
    return NextResponse.json(
      { error: "Muitas gerações em pouco tempo. Aguarde alguns minutos e tente de novo." },
      { status: 429 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const { projectId, message, schema, userKey, userProvider, costMode } = body ?? {};
  if (!projectId || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Requisição incompleta." }, { status: 400 });
  }

  const access = await authorizeProjectOwner(supabase, projectId, user.id, owner);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status ?? 403 });
  }

  const safeSchema = isValidSchema(schema) ? schema : null;
  const requestId = typeof body?.requestId === "string" && isUuid(body.requestId)
    ? body.requestId
    : crypto.randomUUID();

  const { data: sub } = owner ? { data: null } : await supabase.from("subscriptions").select("plan").eq("user_id", user.id).maybeSingle();
  const plan = resolvePlan({ plan: sub?.plan, role: profile?.role, email: user.email });
  const reservation = await reserveGeneration({
    supabase, userId: user.id, projectId, prompt: message,
    limit: plan.maxGenerationsPerMonth, unlimited: owner,
    requestId, kind: "site",
  });
  if (reservation.error) return NextResponse.json({ error: "Não foi possível reservar sua geração. Tente novamente." }, { status: 503 });
  if (reservation.limitReached) return NextResponse.json({
    error: `Você atingiu o limite de ${plan.maxGenerationsPerMonth} gerações do plano ${plan.name} este mês. Faça upgrade para continuar.`, limitReached: true,
  }, { status: 402 });
  if (reservation.inProgress || reservation.duplicateCompleted) {
    return NextResponse.json({
      error: reservation.inProgress
        ? "Este mesmo pedido já está sendo processado. Aguarde a conclusão."
        : "Este pedido já foi concluído e não será cobrado novamente. Atualize o projeto.",
      requestId,
      inProgress: !!reservation.inProgress,
      duplicateCompleted: !!reservation.duplicateCompleted,
    }, { status: 409 });
  }

  // ── Geração (providers com fallback automático) ─────────────
  let result;
  try {
    result = await generateWithProviders({ message, schema: safeSchema,
      userKey: typeof userKey === "string" ? userKey : null,
      userProvider: userProvider ?? null, costMode: costMode ?? "auto" });
  } catch (error) {
    const message = safeOperationalMessage(error);
    await finalizeGeneration(supabase, reservation.id, {
      status: "failed",
      durationMs: Date.now() - started,
      errorCode: classifyGenerationFailure(message),
      errorMessage: message,
      metadata: { requestId, attempt: reservation.attempt ?? 1 },
    });
    console.error("[generation] falha inesperada", error);
    return NextResponse.json({ error: "A geração falhou antes de concluir. Tente novamente." }, { status: 502 });
  }

  // ── Registro de uso + custo real ────────────────────────────
  await finalizeGeneration(supabase, reservation.id, {
    status: "completed",
    provider: result.provider,
    cost: result.cost ?? 0,
    model: result.model ?? null,
    durationMs: Date.now() - started,
    metadata: { requestId, attempt: reservation.attempt ?? 1 },
  });

  const { data: rows } = await supabase.from("generations").select("cost_usd").eq("project_id", projectId);
  const projectCost = (rows ?? []).reduce((s: number, r: any) => s + Number(r.cost_usd ?? 0), 0);

  return NextResponse.json({ ...result, projectCost });
}
