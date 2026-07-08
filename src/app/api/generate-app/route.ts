import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateAppWithProviders } from "@/lib/engine/code-providers";
import { checkRateLimit } from "@/lib/engine/providers";
import { isOwner, resolvePlan } from "@/lib/access";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const owner = isOwner({ role: profile?.role, email: user.email });

  if (!owner && !checkRateLimit(user.id)) {
    return NextResponse.json({ error: "Muitas gerações em pouco tempo. Aguarde e tente de novo." }, { status: 429 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }
  const { projectId, message, currentCode, currentFiles, name, userKey, userProvider, costMode, forceReal, allowTemplate } =
    body ?? {};
  if (!projectId || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Requisição incompleta." }, { status: 400 });
  }

  // limite mensal (owner ignora)
  if (!owner) {
    const { data: sub } = await supabase.from("subscriptions").select("plan").eq("user_id", user.id).maybeSingle();
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
        { error: `Limite de ${plan.maxGenerationsPerMonth} gerações do plano ${plan.name} atingido este mês.`, limitReached: true },
        { status: 402 }
      );
    }
  }

  const result = await generateAppWithProviders({
    message,
    currentCode: typeof currentCode === "string" ? currentCode : null,
    currentFiles: Array.isArray(currentFiles) ? currentFiles : null,
    name: typeof name === "string" ? name : "App",
    userKey: typeof userKey === "string" ? userKey : null,
    userProvider: userProvider ?? null,
    costMode: costMode ?? "auto",
    forceReal: forceReal !== false, // padrão: geração REAL
    allowTemplate: allowTemplate === true,
  });

  // Modo real exigido, mas a IA não gerou. Se temos o motivo técnico real
  // (ex.: modelo 404, chave 401, sem saldo, timeout), mostramos ELE — nada de
  // "nenhuma IA conectada" genérico quando na verdade a chamada falhou.
  if (forceReal !== false && result.engineMode !== "real") {
    const reason = (result as any).failureReason as string | undefined;
    const error = reason
      ? `A geração real falhou: ${reason} — não vou te entregar um demo disfarçado. Verifique sua chave/modelo em Configurações, ou troque para o modo Template/Demo.`
      : "Modo de geração real ativo, mas nenhuma IA está conectada — não vou te entregar um demo disfarçado. Conecte uma chave de IA em Configurações (ou troque para o modo Template/Demo explicitamente).";
    return NextResponse.json(
      { error, needsKey: !reason, generationFailed: !!reason, engineMode: result.engineMode },
      { status: 422 }
    );
  }

  await supabase.from("generations").insert({
    user_id: user.id,
    project_id: projectId,
    prompt: message.slice(0, 2000),
    provider: result.provider,
    status: "completed",
    cost_usd: result.cost ?? 0,
    model: result.model ?? null,
  });

  // custo acumulado do projeto
  const { data: rows } = await supabase.from("generations").select("cost_usd").eq("project_id", projectId);
  const projectCost = (rows ?? []).reduce((s: number, r: any) => s + Number(r.cost_usd ?? 0), 0);

  return NextResponse.json({ ...result, projectCost });
}
