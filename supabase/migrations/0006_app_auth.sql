-- ═══════════════════════════════════════════════════════════════════
-- AD Studio · Login de usuário final dos apps gerados
-- Usuários e sessões por projeto. Estas tabelas contêm hash de senha, então
-- NÃO têm policy para anon/authenticated (RLS nega tudo por padrão). Só a API
-- server-side, com a SERVICE ROLE KEY (que ignora RLS), acessa. Isso mantém
-- os hashes fora do alcance público.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.app_users (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null,
  email       text not null,
  name        text,
  pass_hash   text not null,
  pass_salt   text not null,
  created_at  timestamptz not null default now(),
  unique (project_id, email)
);

create table if not exists public.app_sessions (
  token       text primary key,
  project_id  uuid not null,
  user_id     uuid not null references public.app_users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists app_sessions_user_idx on public.app_sessions (user_id);

-- RLS habilitado e SEM policies → anon/authenticated não acessam.
alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;

select 'migracao 0006 aplicada' as resultado;
