-- Cofre por projeto. O banco recebe somente envelopes AES-GCM gerados no servidor.
create table if not exists public.project_integration_secrets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  provider text not null check (provider in ('stripe','resend','automation')),
  encrypted_config text not null check (length(encrypted_config) between 20 and 20000),
  hint text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, provider)
);

alter table public.project_integration_secrets enable row level security;
revoke all on public.project_integration_secrets from anon, authenticated;
grant all on public.project_integration_secrets to service_role;
