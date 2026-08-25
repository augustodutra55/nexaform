-- Entregas idempotentes das automações declaradas pelos aplicativos gerados.
-- A tabela não é exposta aos apps: somente rotas server-side com service role.
create table if not exists public.app_automation_deliveries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  automation_name text not null check (automation_name ~ '^[A-Za-z][A-Za-z0-9_-]{0,79}$'),
  record_id uuid not null references public.app_data(id) on delete cascade,
  scheduled_for timestamptz not null,
  channel text not null check (channel in ('email')),
  recipient text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  error text,
  attempted_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, automation_name, record_id, scheduled_for)
);

create index if not exists app_automation_deliveries_due_idx
  on public.app_automation_deliveries (status, scheduled_for, created_at);
create index if not exists app_automation_deliveries_record_idx
  on public.app_automation_deliveries (record_id);

alter table public.app_automation_deliveries enable row level security;
revoke all on public.app_automation_deliveries from anon, authenticated;
grant select on public.app_automation_deliveries to authenticated;
grant all on public.app_automation_deliveries to service_role;

create policy "automation deliveries: owner reads"
  on public.app_automation_deliveries for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = (select auth.uid())
  ));
