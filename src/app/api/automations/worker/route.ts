import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  automationRetryDelayMinutes,
  automationWindow,
  type AppAutomationBlueprint,
} from "@/lib/engine/automation-blueprint";
import { sendAutomationEmail } from "@/lib/integrations/commercial";

export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_DELIVERIES_PER_RUN = 100;
const LEASE_MINUTES = 5;

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

  const now = new Date();
  // Uma função interrompida não pode prender a entrega para sempre.
  await admin
    .from("app_automation_deliveries")
    .update({ status: "failed", lease_expires_at: null, next_attempt_at: now.toISOString(), error: "Execução anterior interrompida; reagendada." })
    .eq("status", "processing")
    .lt("lease_expires_at", now.toISOString());

  let inspected = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
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
        const reservation = {
          project_id: project.id,
          automation_name: automation.name,
          record_id: record.id,
          scheduled_for: scheduledFor,
          channel: "email",
          recipient,
          next_attempt_at: now.toISOString(),
        };
        let { data: delivery, error: reserveError } = await admin
          .from("app_automation_deliveries")
          .insert(reservation)
          .select("id,status,attempt_count,next_attempt_at")
          .single();
        if (reserveError?.code === "23505") {
          const existing = await admin
            .from("app_automation_deliveries")
            .select("id,status,attempt_count,next_attempt_at")
            .eq("project_id", project.id)
            .eq("automation_name", automation.name)
            .eq("record_id", record.id)
            .eq("scheduled_for", scheduledFor)
            .maybeSingle();
          delivery = existing.data;
          reserveError = existing.error;
        }
        if (reserveError || !delivery) { failed++; continue; }
        const attempts = Number(delivery.attempt_count) || 0;
        const nextAttempt = delivery.next_attempt_at ? new Date(delivery.next_attempt_at).getTime() : 0;
        if (delivery.status === "sent" || delivery.status === "exhausted" || delivery.status === "processing" ||
            attempts >= 5 || nextAttempt > now.getTime()) { skipped++; continue; }

        const leaseExpiresAt = new Date(now.getTime() + LEASE_MINUTES * 60_000).toISOString();
        const { data: claimed, error: claimError } = await admin
          .from("app_automation_deliveries")
          .update({ status: "processing", attempt_count: attempts + 1, attempted_at: now.toISOString(), lease_expires_at: leaseExpiresAt })
          .eq("id", delivery.id)
          .eq("status", delivery.status)
          .eq("attempt_count", attempts)
          .select("id")
          .maybeSingle();
        if (claimError) { failed++; continue; }
        if (!claimed) { skipped++; continue; }
        try {
          await sendAutomationEmail({
            to: recipient,
            subject: render(automation.subject, record.data),
            message: render(automation.message, record.data),
          });
          await admin.from("app_automation_deliveries").update({ status: "sent", sent_at: new Date().toISOString(), error: null, next_attempt_at: null, lease_expires_at: null }).eq("id", delivery.id);
          sent++;
        } catch (sendError) {
          const delay = automationRetryDelayMinutes(attempts + 1);
          await admin.from("app_automation_deliveries").update({
            status: delay == null ? "exhausted" : "failed",
            next_attempt_at: delay == null ? null : new Date(now.getTime() + delay * 60_000).toISOString(),
            lease_expires_at: null,
            error: String(sendError instanceof Error ? sendError.message : sendError).slice(0, 500),
          }).eq("id", delivery.id);
          failed++;
        }
      }
    }
  }
  return NextResponse.json({ ok: true, inspected, sent, failed, skipped, checkedAt: now.toISOString() });
}
