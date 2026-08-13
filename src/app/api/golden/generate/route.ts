import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateAppWithProviders } from "@/lib/engine/code-providers";
import { verifyGoldenServiceAuth } from "@/lib/golden-auth";
import { isOwner } from "@/lib/access";
import { isUuid } from "@/lib/engine/data-guard";
import { buildStagePrompt, stagedBuildStages } from "@/lib/engine/staged-generation";
import type { AppFile } from "@/lib/engine/app-types";

export const maxDuration = 300;

function safeCurrentFiles(value: unknown): AppFile[] | null {
  if (!Array.isArray(value)) return null;
  const files = value
    .slice(0, 80)
    .filter((file) => file && typeof file.path === "string" && typeof file.content === "string")
    .map((file) => ({ path: String(file.path).slice(0, 300), content: String(file.content).slice(0, 300_000) }));
  return files.length ? files : null;
}

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

  const currentFiles = safeCurrentFiles(body?.currentFiles);
  const requestedStage = Number(body?.stageIndex);
  let generationMessage = message;
  let stage: { index: number; total: number; label: string } | null = null;
  if (Number.isInteger(requestedStage) && requestedStage >= 0) {
    const stages = stagedBuildStages();
    if (requestedStage >= stages.length) {
      return NextResponse.json({ error: "Etapa Golden inválida." }, { status: 400 });
    }
    generationMessage = buildStagePrompt(message, stages[requestedStage], requestedStage, stages.length, "initial");
    stage = { index: requestedStage, total: stages.length, label: stages[requestedStage].label };
  }

  const result = await generateAppWithProviders({
    message: generationMessage,
    currentFiles,
    name: typeof body?.name === "string" ? body.name : "Golden Production",
    costMode: "auto",
    forceReal: true,
    allowTemplate: false,
  });

  if (result.engineMode !== "real") {
    return NextResponse.json({ error: result.failureReason || "Motor real indisponível.", engineMode: result.engineMode, stage }, { status: 502 });
  }
  return NextResponse.json({ ...result, stage });
}
