import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { remixMeta, remixName, templateById, templateCatalog } from "@/lib/templates/remix";

function bad(error: string, status = 400) { return NextResponse.json({ error }, { status }); }

export async function GET() {
  return NextResponse.json({ templates: templateCatalog() });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return bad("Não autenticado.", 401);
  let body: any;
  try { body = await req.json(); } catch { return bad("Corpo inválido."); }

  const sourceProjectId = typeof body?.sourceProjectId === "string" ? body.sourceProjectId : null;
  const templateId = typeof body?.templateId === "string" ? body.templateId : null;
  if (!sourceProjectId && !templateId) return bad("Informe sourceProjectId ou templateId.");

  if (sourceProjectId) {
    const { data: source, error } = await supabase
      .from("projects")
      .select("id,name,description,schema,meta")
      .eq("id", sourceProjectId)
      .maybeSingle();
    if (error || !source) return bad("Projeto de origem não encontrado ou sem acesso.", 404);
    const { data, error: insertError } = await supabase.from("projects").insert({
      user_id: user.id,
      name: remixName(source.name || "Projeto"),
      description: source.description || "",
      schema: source.schema,
      published: false,
      meta: { ...(source.meta && typeof source.meta === "object" ? source.meta : {}), ...remixMeta(source.id, undefined), template: false },
    }).select("id").single();
    if (insertError || !data) return bad(insertError?.message || "Não foi possível criar o remix.", 500);
    return NextResponse.json({ projectId: data.id, mode: "clone" }, { status: 201 });
  }

  const template = templateById(templateId!);
  if (!template) return bad("Template não encontrado.", 404);
  const { data, error } = await supabase.from("projects").insert({
    user_id: user.id,
    name: template.name,
    description: template.prompt.slice(0, 240),
    schema: null,
    published: false,
    meta: { ...remixMeta(undefined, template.id), starterPrompt: template.prompt },
  }).select("id").single();
  if (error || !data) return bad(error?.message || "Não foi possível criar pelo template.", 500);
  return NextResponse.json({ projectId: data.id, mode: "starter", starterPrompt: template.prompt }, { status: 201 });
}
