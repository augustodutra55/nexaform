import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit, isUuid, requestRateKey } from "@/lib/engine/data-guard";
import { safeOperationalMessage } from "@/lib/engine/observability";

export const runtime = "nodejs";

const KINDS = new Set(["runtime_error", "unhandled_rejection", "bridge_error", "audit_error"]);

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;
  if (!isUuid(projectId)) return NextResponse.json({ error: "Projeto inválido." }, { status: 400 });
  if (!(await consumeRateLimit(`telemetry:${projectId}:${requestRateKey(req)}`, 60, 60 * 60_000))) {
    return NextResponse.json({ accepted: false }, { status: 429 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ accepted: false }, { status: 503 });
  const { data: project } = await admin
    .from("projects")
    .select("id, published")
    .eq("id", projectId)
    .maybeSingle();
  if (!project?.published) return NextResponse.json({ accepted: false }, { status: 404 });

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ accepted: false }, { status: 400 });
  }
  const kind = String(body?.kind || "");
  const message = safeOperationalMessage(body?.message);
  if (!KINDS.has(kind) || !message) {
    return NextResponse.json({ accepted: false }, { status: 400 });
  }
  const normalized = message.toLowerCase().replace(/\b\d+\b/g, "#").slice(0, 500);
  const fingerprint = crypto.createHash("sha256").update(`${kind}:${normalized}`).digest("hex");
  let contextData: Record<string, string | number | boolean | null> = {};
  if (body?.context && typeof body.context === "object" && !Array.isArray(body.context)) {
    for (const key of Object.keys(body.context).slice(0, 12)) {
      const value = body.context[key];
      if (typeof value === "string") contextData[key.slice(0, 80)] = safeOperationalMessage(value, 300);
      else if (typeof value === "number" || typeof value === "boolean" || value === null) contextData[key.slice(0, 80)] = value;
    }
  }
  const { error } = await admin.from("runtime_events").insert({
    project_id: projectId,
    kind,
    message,
    fingerprint,
    context: contextData,
    user_agent: safeOperationalMessage(req.headers.get("user-agent"), 300) || null,
  });
  // Antes da migração 0013, o endpoint degrada sem quebrar o app publicado.
  if (error) {
    console.warn("[telemetry] evento não persistido", projectId, error.message);
    return NextResponse.json({ accepted: false }, { status: 202 });
  }
  return NextResponse.json({ accepted: true }, { status: 202 });
}
