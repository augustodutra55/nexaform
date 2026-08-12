import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeWorkspaceName } from "@/lib/collaboration/workspace";

function bad(error: string, status = 400) { return NextResponse.json({ error }, { status }); }

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return bad("Não autenticado.", 401);
  const { data, error } = await supabase.from("workspaces").select("id,name,owner_id,created_at,updated_at").order("updated_at", { ascending: false });
  if (error) return bad(error.message, 500);
  return NextResponse.json({ workspaces: data || [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return bad("Não autenticado.", 401);
  let body: any;
  try { body = await req.json(); } catch { return bad("Corpo inválido."); }
  try {
    const name = normalizeWorkspaceName(String(body?.name || ""));
    const { data, error } = await supabase.from("workspaces").insert({ owner_id: user.id, name }).select("id,name,owner_id,created_at,updated_at").single();
    if (error) return bad(error.message, 500);
    return NextResponse.json({ workspace: data }, { status: 201 });
  } catch (error: any) {
    return bad(String(error?.message || error));
  }
}
