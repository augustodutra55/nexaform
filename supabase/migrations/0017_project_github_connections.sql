-- Bloco 2 do roadmap: conexão GitHub por projeto via GitHub App.
-- Nunca armazena PAT/token de instalação. Tokens efêmeros são emitidos no servidor.

create table if not exists public.project_github_connections (
  project_id uuid primary key references public.projects(id) on delete cascade,
  installation_id bigint not null check (installation_id > 0),
  repo_owner text not null check (repo_owner ~ '^[A-Za-z0-9._-]+$'),
  repo_name text not null check (repo_name ~ '^[A-Za-z0-9._-]+$'),
  branch text not null default 'main',
  root_path text not null default '',
  last_remote_sha text,
  last_local_fingerprint text,
  last_sync_status text not null default 'idle' check (last_sync_status in ('idle','syncing','synced','conflict','error')),
  last_sync_message text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists project_github_repo_idx
  on public.project_github_connections (installation_id, repo_owner, repo_name, branch, root_path);

alter table public.project_github_connections enable row level security;

drop policy if exists "project github: dono CRUD" on public.project_github_connections;
create policy "project github: dono CRUD" on public.project_github_connections
  for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid()
    )
  );

-- Não há coluna para access_token, refresh_token, PAT ou private key por design.
comment on table public.project_github_connections is
  'Metadados não secretos da conexão GitHub App por projeto. Tokens de instalação são efêmeros e nunca persistidos.';
