import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/access";
import { authorizeProjectOwner, isUuid } from "@/lib/engine/data-guard";
import { aggregateProjectCost, suggestSalePrice } from "@/lib/cost/project-cost";

/**
 * Resumo de custo real do projeto — quanto já foi gasto em gerações, por
 * modelo e por dia, com uma sugestão de preço de venda. Ajuda o criador a
 * precificar o trabalho e a comparar com o custo fixo de outras ferramentas.
 *
 * GET /api/cost/[projectId]
 */
export const maxDuration = 20;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  if (!projectId || !isUuid(projectId)) {
    return NextResponse.json({ error: "Projeto inválido." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const owner = isOwner({ role: profile?.role, email: user.email });
  const access = await authorizeProjectOwner(supabase, projectId, user.id, owner);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status ?? 403 });
  }

  const { data: rows, error } = await supabase
    .from("generations")
    .select("cost_usd, model, provider, status, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) {
    return NextResponse.json({ error: "Não foi possível carregar o custo." }, { status: 503 });
  }

  const summary = aggregateProjectCost(rows ?? []);
  return NextResponse.json({
    ...summary,
    suggestedPrice: suggestSalePrice(summary.totalUsd),
  });
}
