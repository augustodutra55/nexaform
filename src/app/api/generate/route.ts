import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateWithProviders, checkRateLimit } from "@/lib/engine/providers";
import { isValidSchema } from "@/lib/engine/types";
import { isOwner, resolvePlan } from "@/lib/access";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = createClient();
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

  if (!owner && !checkRateLimit(user.id)) {
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

  const { projectId, message, schema, userKey, userProvider } = body ?? {};
  if (!projectId || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Requisição incompleta." }, { status: 400 });
  }
  const safeSchema = isValidSchema(schema) ? schema : null;

  // ── Limite do plano (gerações no mês corrente) — owner ignora ──
  if (!owner) {
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("plan")
      .eq("user_id", user.id)
      .maybeSingle();
    const plan = resolvePlan({ plan: sub?.plan, role: profile?.role, email: user.email });

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const { count } = await supabase
      .from("generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", monthStart.toISOString());

    if ((count ?? 0) >= plan.maxGenerationsPerMonth) {
      return NextResponse.json(
        {
          error: `Você atingiu o limite de ${plan.maxGenerationsPerMonth} gerações do plano ${plan.name} este mês. Faça upgrade para continuar.`,
          limitReached: true,
        },
        { status: 402 }
      );
    }
  }

  // ── Geração (providers com fallback automático) ─────────────
  const result = await generateWithProviders({
    message,
    schema: safeSchema,
    userKey: typeof userKey === "string" ? userKey : null,
    userProvider: userProvider ?? null,
  });

  // ── Registro de uso ─────────────────────────────────────────
  await supabase.from("generations").insert({
    user_id: user.id,
    project_id: projectId,
    prompt: message.slice(0, 2000),
    provider: result.provider,
    status: "completed",
  });

  return NextResponse.json(result);
}
