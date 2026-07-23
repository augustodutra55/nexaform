-- AD Studio · Observabilidade operacional e repetição segura.
-- Mantém o histórico existente e acrescenta dados suficientes para diagnosticar
-- custo, latência e falhas sem armazenar chaves ou respostas completas da IA.

alter table public.generations
  add column if not exists request_id uuid,
  add column if not exists attempt integer not null default 1 check (attempt between 1 and 20),
  add column if not exists kind text not null default 'app' check (kind in ('app', 'site')),
  add column if not exists duration_ms integer check (duration_ms is null or duration_ms >= 0),
  add column if not exists error_code text,
  add column if not exists error_message text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists generations_request_once_idx
  on public.generations (user_id, request_id)
  where request_id is not null;
create index if not exists generations_project_status_created_idx
  on public.generations (project_id, status, created_at desc);

create table if not exists public.runtime_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('runtime_error', 'unhandled_rejection', 'bridge_error', 'audit_error')),
  message text not null check (char_length(message) between 1 and 800),
  fingerprint text not null check (char_length(fingerprint) = 64),
  context jsonb not null default '{}'::jsonb,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists runtime_events_project_created_idx
  on public.runtime_events (project_id, created_at desc);
create index if not exists runtime_events_fingerprint_idx
  on public.runtime_events (project_id, fingerprint, created_at desc);

alter table public.runtime_events enable row level security;
drop policy if exists "runtime events: dono lê" on public.runtime_events;
create policy "runtime events: dono lê" on public.runtime_events
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid()
    )
  );
grant select on public.runtime_events to authenticated;
revoke insert, update, delete on public.runtime_events from anon, authenticated;

create or replace function public.reserve_generation_observed(
  p_project_id uuid, p_limit integer, p_prompt text,
  p_request_id uuid, p_kind text default 'app'
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
  v_row public.generations%rowtype;
begin
  if v_user is null or p_limit < 1 or p_request_id is null
     or p_kind not in ('app', 'site') then
    return jsonb_build_object('state', 'invalid');
  end if;
  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.user_id = v_user
  ) then raise exception 'project_not_owned'; end if;

  perform pg_advisory_xact_lock(hashtext(v_user::text || ':' || p_request_id::text));
  select * into v_row from public.generations g
  where g.user_id = v_user and g.request_id = p_request_id
  limit 1;

  if found then
    if v_row.status = 'completed' then
      return jsonb_build_object('state', 'duplicate_completed', 'id', v_row.id, 'attempt', v_row.attempt);
    end if;
    if v_row.status = 'pending' and v_row.updated_at > now() - interval '6 minutes' then
      return jsonb_build_object('state', 'in_progress', 'id', v_row.id, 'attempt', v_row.attempt);
    end if;
    update public.generations set
      status = 'pending', provider = 'pending', attempt = least(attempt + 1, 20),
      prompt = left(coalesce(p_prompt, ''), 2000), kind = p_kind,
      duration_ms = null, error_code = null, error_message = null,
      metadata = '{}'::jsonb, updated_at = now()
    where id = v_row.id
    returning * into v_row;
    return jsonb_build_object('state', 'retry', 'id', v_row.id, 'attempt', v_row.attempt);
  end if;

  select count(*) into v_count from public.generations g
  where g.user_id = v_user and g.created_at >= date_trunc('month', now());
  if v_count >= p_limit then return jsonb_build_object('state', 'limit'); end if;

  insert into public.generations(
    user_id, project_id, prompt, provider, status, request_id, kind, updated_at
  ) values (
    v_user, p_project_id, left(coalesce(p_prompt, ''), 2000), 'pending',
    'pending', p_request_id, p_kind, now()
  ) returning * into v_row;
  return jsonb_build_object('state', 'reserved', 'id', v_row.id, 'attempt', 1);
end;
$$;
revoke all on function public.reserve_generation_observed(uuid, integer, text, uuid, text) from public;
grant execute on function public.reserve_generation_observed(uuid, integer, text, uuid, text) to authenticated;

create or replace function public.finalize_generation_observed(
  p_generation_id uuid, p_status text, p_provider text default null,
  p_cost_usd numeric default 0, p_model text default null,
  p_duration_ms integer default null, p_error_code text default null,
  p_error_message text default null, p_metadata jsonb default '{}'::jsonb
)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or p_status not in ('completed', 'failed') then return false; end if;
  update public.generations set
    status = p_status,
    provider = coalesce(nullif(p_provider, ''), provider),
    cost_usd = greatest(coalesce(p_cost_usd, 0), 0),
    model = p_model,
    duration_ms = greatest(coalesce(p_duration_ms, 0), 0),
    error_code = left(nullif(p_error_code, ''), 80),
    error_message = left(nullif(p_error_message, ''), 800),
    metadata = coalesce(p_metadata, '{}'::jsonb),
    updated_at = now()
  where id = p_generation_id and user_id = auth.uid();
  return found;
end;
$$;
revoke all on function public.finalize_generation_observed(uuid, text, text, numeric, text, integer, text, text, jsonb) from public;
grant execute on function public.finalize_generation_observed(uuid, text, text, numeric, text, integer, text, text, jsonb) to authenticated;

select 'migracao 0013 aplicada: observabilidade operacional ativa' as resultado;
