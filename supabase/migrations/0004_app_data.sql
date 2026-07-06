-- ═══════════════════════════════════════════════════════════════════
-- AD Studio · Backend de dados por projeto (persistência dos apps gerados)
-- Uma tabela compartilhada, escopada por project_id. Os apps gerados leem/
-- escrevem via /api/data/[projectId] (a API impõe o escopo e os limites).
-- É o "backend embutido" que dá persistência real sem provisionar infra por app.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.app_data (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null,
  collection  text not null default 'default',
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists app_data_project_idx on public.app_data (project_id, collection, created_at);

alter table public.app_data enable row level security;

-- Acesso pelo papel público (anon E authenticated): o preview roda com a sessão
-- do dono (authenticated) e o app publicado sem sessão (anon). A API server-side
-- impõe o escopo por project_id e os limites de tamanho/linhas.
drop policy if exists "app_data read" on public.app_data;
drop policy if exists "app_data write" on public.app_data;
drop policy if exists "app_data update" on public.app_data;
drop policy if exists "app_data delete" on public.app_data;

create policy "app_data read"   on public.app_data for select to public using (true);
create policy "app_data write"  on public.app_data for insert to public with check (true);
create policy "app_data update" on public.app_data for update to public using (true) with check (true);
create policy "app_data delete" on public.app_data for delete to public using (true);

grant select, insert, update, delete on public.app_data to anon, authenticated;

select 'migracao 0004 aplicada' as resultado;
