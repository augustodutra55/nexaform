import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateAppWithProviders } from "@/lib/engine/code-providers";
import { verifyGoldenServiceAuth } from "@/lib/golden-auth";
import { isOwner } from "@/lib/access";
import { isUuid } from "@/lib/engine/data-guard";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!verifyGoldenServiceAuth(req)) return NextResponse.json({ error: "Golden auth inválida." }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Admin client indisponível." }, { status: 503 });

  const body = await req.json().catch(() => null);
  const projectId = String(body?.projectId || "");
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!isUuid(projectId) || !message) return NextResponse.json({ error: "Requisição incompleta." }, { status: 400 });

  const { data: project } = await admin.from("projects").select("user_id").eq("id", projectId).maybeSingle();
  if (!project?.user_id) return NextResponse.json({ error: "Projeto Golden não encontrado." }, { status: 404 });

  const [{ data: authUser }, { data: profile }] = await Promise.all([
    admin.auth.admin.getUserById(project.user_id),
    admin.from("profiles").select("role").eq("id", project.user_id).maybeSingle(),
  ]);
  if (!isOwner({ email: authUser?.user?.email, role: profile?.role })) {
    return NextResponse.json({ error: "Projeto Golden não pertence ao owner." }, { status: 403 });
  }

  const result = await generateAppWithProviders({
    message,
    name: typeof body?.name === "string" ? body.name : "Golden Production",
    costMode: "auto",
    forceReal: true,
    allowTemplate: false,
  });

  if (result.engineMode !== "real") {
    return NextResponse.json({ error: result.failureReason || "Motor real indisponível.", engineMode: result.engineMode }, { status: 502 });
  }
  return NextResponse.json(result);
}
