-- AD Studio · Retomada durável da construção por etapas.
-- O navegador continua sendo o cache rápido; esta tabela permite retomar o
-- trabalho em outro navegador ou depois de limpar os dados locais.

create table if not exists public.staged_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

create index if not exists staged_generation_jobs_user_status_idx
  on public.staged_generation_jobs (user_id, status, updated_at desc);

drop trigger if exists staged_generation_jobs_touch on public.staged_generation_jobs;
create trigger staged_generation_jobs_touch
  before update on public.staged_generation_jobs
  for each row execute function public.touch_updated_at();

alter table public.staged_generation_jobs enable row level security;

drop policy if exists "staged jobs: dono CRUD" on public.staged_generation_jobs;
create policy "staged jobs: dono CRUD" on public.staged_generation_jobs
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
    and exists (
      select 1 from public.chat_threads t
      where t.id = thread_id
        and t.project_id = project_id
        and t.user_id = auth.uid()
    )
    and octet_length(payload::text) <= 262144
  );

grant select, insert, update, delete on public.staged_generation_jobs to authenticated;
revoke all on public.staged_generation_jobs from anon;

select 'migracao 0014 aplicada: retomada duravel ativa' as resultado;
