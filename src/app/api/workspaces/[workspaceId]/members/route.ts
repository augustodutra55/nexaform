import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeInviteEmail, normalizeMemberRole } from "@/lib/collaboration/workspace";

function bad(error: string, status = 400) { return NextResponse.json({ error }, { status }); }

async function context(workspaceId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, response: bad("Não autenticado.", 401) };
  const { data: role, error } = await supabase.rpc("workspace_access_role", { p_workspace_id: workspaceId });
  if (error) return { supabase, response: bad(error.message, 500) };
  if (role !== "owner" && role !== "admin") return { supabase, response: bad("Somente owner/admin gerencia membros.", 403) };
  return { supabase, response: null };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const ctx = await context(workspaceId);
  if (ctx.response) return ctx.response;
  const { data, error } = await ctx.supabase.from("workspace_members")
    .select("id,user_id,invited_email,role,status,created_at,updated_at")
    .eq("workspace_id", workspaceId)
    .neq("status", "revoked")
    .order("created_at", { ascending: true });
  if (error) return bad(error.message, 500);
  return NextResponse.json({ members: data || [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const ctx = await context(workspaceId);
  if (ctx.response) return ctx.response;
  let body: any;
  try { body = await req.json(); } catch { return bad("Corpo inválido."); }
  try {
    const invitedEmail = normalizeInviteEmail(String(body?.email || ""));
    const role = normalizeMemberRole(String(body?.role || "viewer"));
    const now = new Date().toISOString();
    const { data, error } = await ctx.supabase.from("workspace_members").insert({
      workspace_id: workspaceId,
      invited_email: invitedEmail,
      role,
      status: "invited",
      updated_at: now,
    }).select("id,invited_email,role,status,created_at").single();
    if (error) return bad(error.message, 409);
    return NextResponse.json({ member: data }, { status: 201 });
  } catch (error: any) {
    return bad(String(error?.message || error));
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const ctx = await context(workspaceId);
  if (ctx.response) return ctx.response;
  const memberId = new URL(req.url).searchParams.get("memberId");
  if (!memberId) return bad("memberId é obrigatório.");
  const { error } = await ctx.supabase.from("workspace_members")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", memberId);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
