import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { automationWindow, type AppAutomationBlueprint } from "@/lib/engine/automation-blueprint";
import { sendAutomationEmail } from "@/lib/integrations/commercial";

export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_DELIVERIES_PER_RUN = 100;

function render(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]{0,79})\}\}/g, (_match, field) =>
    data[field] == null ? "" : String(data[field]).slice(0, 500)
  );
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase não configurado." }, { status: 501 });
  const { data: projects, error } = await admin.from("projects").select("id,meta").eq("published", true).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let inspected = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const now = new Date();
  for (const project of projects ?? []) {
    const automations = project?.meta?.backendProvisioning?.automations;
    if (!Array.isArray(automations)) continue;
    for (const automation of automations as AppAutomationBlueprint[]) {
      if (sent + failed >= MAX_DELIVERIES_PER_RUN) break;
      const window = automationWindow(now, automation.leadMinutes);
      const remaining = MAX_DELIVERIES_PER_RUN - sent - failed;
      const { data: records, error: recordsError } = await admin
        .from("app_data")
        .select("id,data")
        .eq("project_id", project.id)
        .eq("collection", automation.collection)
        .gte(`data->>${automation.dueField}`, window.start)
        .lt(`data->>${automation.dueField}`, window.end)
        .limit(remaining);
      if (recordsError) { failed++; continue; }
      for (const record of records ?? []) {
        inspected++;
        const recipient = String(record?.data?.[automation.recipientField] || "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) { skipped++; continue; }
        const scheduledFor = String(record.data[automation.dueField]);
        const { data: delivery, error: reserveError } = await admin
          .from("app_automation_deliveries")
          .insert({
            project_id: project.id,
            automation_name: automation.name,
            record_id: record.id,
            scheduled_for: scheduledFor,
            channel: "email",
            recipient,
          })
          .select("id")
          .single();
        if (reserveError?.code === "23505") { skipped++; continue; }
        if (reserveError || !delivery) { failed++; continue; }
        try {
          await sendAutomationEmail({
            to: recipient,
            subject: render(automation.subject, record.data),
            message: render(automation.message, record.data),
          });
          await admin.from("app_automation_deliveries").update({ status: "sent", attempted_at: now.toISOString(), sent_at: new Date().toISOString(), error: null }).eq("id", delivery.id);
          sent++;
        } catch (sendError) {
          await admin.from("app_automation_deliveries").update({ status: "failed", attempted_at: now.toISOString(), error: String(sendError instanceof Error ? sendError.message : sendError).slice(0, 500) }).eq("id", delivery.id);
          failed++;
        }
      }
    }
  }
  return NextResponse.json({ ok: true, inspected, sent, failed, skipped, checkedAt: now.toISOString() });
}
