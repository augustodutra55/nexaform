-- Workspaces colaborativos sem alterar o comportamento dos projetos existentes.
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  invited_email text,
  role text not null check (role in ('admin','editor','viewer')),
  status text not null default 'active' check (status in ('invited','active','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  check (user_id is not null or invited_email is not null)
);

alter table public.projects add column if not exists workspace_id uuid references public.workspaces(id) on delete set null;
create index if not exists projects_workspace_id_idx on public.projects(workspace_id);
create index if not exists workspace_members_user_idx on public.workspace_members(user_id, status);
create unique index if not exists workspace_members_pending_email_idx
  on public.workspace_members(workspace_id, lower(invited_email)) where user_id is null and invited_email is not null;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create or replace function public.workspace_access_role(p_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists(select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_id = auth.uid()) then 'owner'
    else (
      select wm.role from public.workspace_members wm
      where wm.workspace_id = p_workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
      limit 1
    )
  end;
$$;

revoke all on function public.workspace_access_role(uuid) from public;
grant execute on function public.workspace_access_role(uuid) to authenticated;

create policy "workspace visible to members" on public.workspaces
for select to authenticated
using (public.workspace_access_role(id) is not null);

create policy "workspace owner can insert" on public.workspaces
for insert to authenticated
with check (owner_id = auth.uid());

create policy "workspace owner or admin can update" on public.workspaces
for update to authenticated
using (public.workspace_access_role(id) in ('owner','admin'))
with check (public.workspace_access_role(id) in ('owner','admin'));

create policy "workspace owner can delete" on public.workspaces
for delete to authenticated
using (owner_id = auth.uid());

create policy "members visible inside workspace" on public.workspace_members
for select to authenticated
using (public.workspace_access_role(workspace_id) is not null);

create policy "owner or admin manages members" on public.workspace_members
for all to authenticated
using (public.workspace_access_role(workspace_id) in ('owner','admin'))
with check (public.workspace_access_role(workspace_id) in ('owner','admin'));

-- Acesso aos projetos de workspace é aditivo. As policies existentes de dono continuam válidas.
create policy "workspace members can read projects" on public.projects
for select to authenticated
using (workspace_id is not null and public.workspace_access_role(workspace_id) is not null);

create policy "workspace editors can update projects" on public.projects
for update to authenticated
using (workspace_id is not null and public.workspace_access_role(workspace_id) in ('owner','admin','editor'))
with check (workspace_id is null or public.workspace_access_role(workspace_id) in ('owner','admin','editor'));
