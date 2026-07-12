-- AD Studio · Fundação de segurança do runtime público.
create extension if not exists pgcrypto;

drop policy if exists "projects: público lê publicados" on public.projects;

create or replace function public.get_public_project(p_slug text)
returns table (
  id uuid, name text, description text, schema jsonb, published boolean,
  share_slug text, meta jsonb, build_bundle text
)
language sql stable security definer set search_path = public
as $$
  select p.id, p.name, p.description, p.schema, p.published, p.share_slug,
    jsonb_strip_nulls(jsonb_build_object(
      'whitelabel', p.meta -> 'whitelabel', 'client', p.meta -> 'client'
    )), p.build_bundle
  from public.projects p
  where p.share_slug = p_slug and p.published = true
    and char_length(p_slug) between 1 and 120
  limit 1;
$$;
revoke all on function public.get_public_project(text) from public;
grant execute on function public.get_public_project(text) to anon, authenticated;

drop policy if exists "app_uploads write" on storage.objects;
drop policy if exists "app_uploads authenticated write" on storage.objects;
update storage.buckets
set file_size_limit = 5242880,
  allowed_mime_types = array[
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/pdf', 'text/plain'
  ]
where id = 'app-uploads';

alter table public.app_sessions
  add column if not exists token_hashed boolean not null default false;
update public.app_sessions
set token = encode(digest(token, 'sha256'), 'hex'), token_hashed = true
where token_hashed = false;

create table if not exists public.api_rate_limits (
  key_hash text primary key,
  hits integer not null default 0,
  window_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from anon, authenticated;

create or replace function public.consume_rate_limit(
  p_key_hash text, p_limit integer, p_window_seconds integer
)
returns boolean language plpgsql security definer set search_path = public
as $$
declare v_hits integer;
begin
  if char_length(p_key_hash) <> 64 or p_limit < 1 or p_limit > 10000
     or p_window_seconds < 1 or p_window_seconds > 2678400 then return false; end if;
  insert into public.api_rate_limits(key_hash, hits, window_started_at, updated_at)
  values (p_key_hash, 1, now(), now())
  on conflict (key_hash) do update set
    hits = case when public.api_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
      then 1 else public.api_rate_limits.hits + 1 end,
    window_started_at = case when public.api_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
      then now() else public.api_rate_limits.window_started_at end,
    updated_at = now()
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;
revoke all on function public.consume_rate_limit(text, integer, integer) from public;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

create or replace function public.reserve_generation(
  p_project_id uuid, p_limit integer, p_prompt text
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_user uuid := auth.uid(); v_count integer; v_id uuid;
begin
  if v_user is null or p_limit < 1 then return null; end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.user_id = v_user)
    then raise exception 'project_not_owned'; end if;
  perform pg_advisory_xact_lock(hashtext(v_user::text));
  select count(*) into v_count from public.generations g
  where g.user_id = v_user and g.created_at >= date_trunc('month', now());
  if v_count >= p_limit then return null; end if;
  insert into public.generations(user_id, project_id, prompt, provider, status)
  values (v_user, p_project_id, left(coalesce(p_prompt, ''), 2000), 'pending', 'pending')
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.reserve_generation(uuid, integer, text) from public;
grant execute on function public.reserve_generation(uuid, integer, text) to authenticated;

create or replace function public.finalize_generation(
  p_generation_id uuid, p_status text, p_provider text default null,
  p_cost_usd numeric default 0, p_model text default null
)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or p_status not in ('completed', 'failed') then return false; end if;
  update public.generations set status = p_status,
    provider = coalesce(nullif(p_provider, ''), provider),
    cost_usd = greatest(coalesce(p_cost_usd, 0), 0), model = p_model
  where id = p_generation_id and user_id = auth.uid();
  return found;
end;
$$;
revoke all on function public.finalize_generation(uuid, text, text, numeric, text) from public;
grant execute on function public.finalize_generation(uuid, text, text, numeric, text) to authenticated;

revoke execute on function public.bump_view(uuid) from anon, authenticated;
grant execute on function public.bump_view(uuid) to service_role;

select 'migracao 0010 aplicada: runtime publico endurecido' as resultado;
