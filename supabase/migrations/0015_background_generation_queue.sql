-- AD Studio · Fila transacional para gerações em segundo plano.
-- Evolui a retomada manual da migration 0014 para um contrato que permite
-- workers concorrentes processarem uma etapa por vez, com retry seguro.

alter table public.staged_generation_jobs
  drop constraint if exists staged_generation_jobs_status_check;

-- A migration pode ser retomada depois de uma execução parcial. Remova também
-- a constraint de tentativas antes de qualquer ADD para manter o script
-- idempotente no SQL Editor do Supabase.
alter table public.staged_generation_jobs
  drop constraint if exists staged_generation_jobs_attempts_check;

alter table public.staged_generation_jobs
  add column if not exists attempts integer not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists last_error text,
  add column if not exists completed_at timestamptz;

alter table public.staged_generation_jobs
  add constraint staged_generation_jobs_status_check
  check (status in (
    'active', 'queued', 'running', 'retry',
    'completed', 'failed', 'cancelled'
  )) not valid;

alter table public.staged_generation_jobs
  validate constraint staged_generation_jobs_status_check;

alter table public.staged_generation_jobs
  add constraint staged_generation_jobs_attempts_check
  check (attempts between 0 and 10) not valid;

alter table public.staged_generation_jobs
  validate constraint staged_generation_jobs_attempts_check;

create index if not exists staged_generation_jobs_queue_idx
  on public.staged_generation_jobs (status, next_attempt_at, updated_at)
  where status in ('queued', 'retry', 'running');

create or replace function public.claim_staged_generation_job(
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns setof public.staged_generation_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role'
     or char_length(coalesce(p_worker_id, '')) not between 8 and 120
     or p_lease_seconds not between 30 and 900 then
    return;
  end if;

  select j.id into v_job_id
  from public.staged_generation_jobs j
  where (
    j.status in ('queued', 'retry')
    and j.next_attempt_at <= now()
  ) or (
    j.status = 'running'
    and j.locked_at < now() - make_interval(secs => p_lease_seconds)
  )
  order by j.next_attempt_at, j.updated_at
  for update skip locked
  limit 1;

  if v_job_id is null then return; end if;

  return query
  update public.staged_generation_jobs
  set status = 'running',
      attempts = attempts + 1,
      locked_at = now(),
      locked_by = p_worker_id,
      last_error = null,
      updated_at = now()
  where id = v_job_id
  returning *;
end;
$$;

revoke all on function public.claim_staged_generation_job(text, integer) from public;
grant execute on function public.claim_staged_generation_job(text, integer) to service_role;

select 'migracao 0015 aplicada: fila transacional ativa' as resultado;
