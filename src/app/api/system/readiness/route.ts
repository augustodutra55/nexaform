import { NextResponse } from "next/server";
import { isOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { probeCheck, summarizeReadiness } from "@/lib/system/readiness";

export const dynamic = "force-dynamic";

async function tableProbe(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  table: string,
  columns: string
): Promise<boolean> {
  const { error } = await admin.from(table).select(columns, { head: true, count: "exact" }).limit(1);
  return !error;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!isOwner({ role: profile?.role, email: user.email })) {
    return NextResponse.json({ error: "Acesso exclusivo do administrador." }, { status: 403 });
  }

  const admin = createAdminClient();
  const checks = [
    probeCheck({
      id: "supabase-public",
      label: "Conexão pública com Supabase",
      ok: !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      readyDetail: "URL e chave pública estão configuradas.",
      missingDetail: "Faltam a URL ou a chave pública do Supabase.",
      action: "Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY na Vercel.",
    }),
    probeCheck({
      id: "service-role",
      label: "Operações seguras do servidor",
      ok: !!admin,
      readyDetail: "Service role disponível somente no servidor.",
      missingDetail: "A service role não está configurada.",
      action: "Configure SUPABASE_SERVICE_ROLE_KEY na Vercel.",
    }),
    probeCheck({
      id: "background-worker",
      label: "Worker de geração em segundo plano",
      ok: !!process.env.CRON_SECRET && !!process.env.OPENROUTER_API_KEY,
      readyDetail: "Cron autenticado e provedor do servidor estão configurados.",
      missingDetail: "O worker não possui todas as credenciais necessárias.",
      action: "Configure CRON_SECRET e OPENROUTER_API_KEY na Vercel.",
    }),
  ];

  if (!admin) {
    return NextResponse.json(summarizeReadiness(checks));
  }

  const [
    collectionPermissions,
    securityFoundation,
    professionalBackend,
    observability,
    durableJobs,
    backgroundQueue,
    backgroundQueueRpc,
    mediaBucket,
  ] = await Promise.all([
    tableProbe(admin, "app_collection_settings", "id,profile,public_read,owner_only"),
    tableProbe(admin, "api_rate_limits", "key_hash,hits,window_started_at"),
    Promise.all([
      tableProbe(admin, "app_users", "id,project_id,role"),
      tableProbe(admin, "app_collection_settings", "allowed_roles,authenticated_scope,data_contract"),
    ]).then((results) => results.every(Boolean)),
    Promise.all([
      tableProbe(admin, "runtime_events", "id,project_id,kind,fingerprint"),
      tableProbe(admin, "generations", "request_id,attempt,kind,duration_ms,error_code"),
    ]).then((results) => results.every(Boolean)),
    tableProbe(admin, "staged_generation_jobs", "id,project_id,thread_id,status,payload"),
    tableProbe(admin, "staged_generation_jobs", "attempts,next_attempt_at,locked_at,locked_by,last_error"),
    admin.rpc("claim_staged_generation_job", {
      p_worker_id: "readiness-probe",
      p_lease_seconds: 0,
    }).then(({ error }) => !error),
    admin.storage.getBucket("app-uploads").then(({ data, error }) =>
      !error
      && !!data
      && Number(data.file_size_limit ?? 0) >= 52_428_800
      && ["audio/mpeg", "audio/wav", "audio/mp4", "audio/webm"].every(
        (type) => Array.isArray(data.allowed_mime_types) && data.allowed_mime_types.includes(type)
      )
    ),
  ]);

  checks.push(
    probeCheck({
      id: "migration-0009",
      label: "Permissões por coleção",
      ok: collectionPermissions,
      readyDetail: "Migration 0009 ativa; coleções são privadas por padrão.",
      missingDetail: "A estrutura de permissões por coleção não foi encontrada.",
      action: "Aplique supabase/migrations/0009_collection_permissions.sql.",
    }),
    probeCheck({
      id: "migration-0010",
      label: "Fundação de segurança",
      ok: securityFoundation,
      readyDetail: "Migration 0010 ativa; rate limit e runtime público endurecido.",
      missingDetail: "A fundação de segurança não está completa.",
      action: "Aplique supabase/migrations/0010_security_foundation.sql.",
    }),
    probeCheck({
      id: "migration-0011",
      label: "Central de mídia",
      ok: mediaBucket,
      readyDetail: "Bucket app-uploads aceita imagens, áudios e vídeos de até 50 MB.",
      missingDetail: "O bucket de mídia está ausente, possui limite antigo ou não aceita áudio.",
      action: "Aplique supabase/migrations/0011_project_media.sql.",
    }),
    probeCheck({
      id: "migration-0012",
      label: "Backend profissional",
      ok: professionalBackend,
      readyDetail: "Papéis, contratos e isolamento por projeto estão ativos.",
      missingDetail: "O backend profissional ainda está no modo de compatibilidade.",
      action: "Aplique supabase/migrations/0012_professional_app_backend.sql.",
    }),
    probeCheck({
      id: "migration-0013",
      label: "Observabilidade",
      ok: observability,
      readyDetail: "Métricas, falhas e repetição segura estão ativas.",
      missingDetail: "A observabilidade detalhada ainda não está ativa.",
      action: "Aplique supabase/migrations/0013_operational_observability.sql.",
    }),
    probeCheck({
      id: "migration-0014",
      label: "Retomada durável",
      ok: durableJobs,
      readyDetail: "Gerações por etapas podem ser retomadas em outro navegador.",
      missingDetail: "A retomada ainda depende somente do navegador.",
      action: "Aplique supabase/migrations/0014_durable_generation_jobs.sql.",
    }),
    probeCheck({
      id: "migration-0015",
      label: "Fila de geração",
      ok: backgroundQueue && backgroundQueueRpc,
      readyDetail: "Fila transacional pronta para processamento em segundo plano.",
      missingDetail: "A fila não possui todas as colunas ou a função transacional de claim.",
      action: "Aplique supabase/migrations/0015_background_generation_queue.sql.",
    }),
    probeCheck({
      id: "openrouter-server",
      label: "Fallback de IA do servidor",
      ok: !!process.env.OPENROUTER_API_KEY,
      readyDetail: "OpenRouter disponível como fallback de geração e imagens.",
      missingDetail: "Somente a chave informada no navegador poderá ser usada.",
      action: "Opcional: configure OPENROUTER_API_KEY na Vercel.",
      optional: true,
    })
  );

  return NextResponse.json(summarizeReadiness(checks), {
    headers: { "cache-control": "private, no-store" },
  });
}
