-- Plan/Agent: planos persistentes antes da execução pela IA.
create table if not exists public.project_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null,
  plan jsonb not null,
  status text not null default 'draft' check (status in ('draft','approved','executing','completed','cancelled')),
  approved_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_plans_project_idx
  on public.project_plans (project_id, created_at desc);

alter table public.project_plans enable row level security;

drop policy if exists "project_plans: dono CRUD" on public.project_plans;
create policy "project_plans: dono CRUD" on public.project_plans
  for all
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid()
    )
  );
