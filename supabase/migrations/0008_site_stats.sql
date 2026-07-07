-- ═══════════════════════════════════════════════════════════════════
-- AD Studio · Analytics de visitas dos sites publicados
-- Contador simples e agregado por projeto (sem dados pessoais do visitante).
-- A contagem é incrementada por uma função SECURITY DEFINER, chamável pelo
-- papel público (o site publicado é anônimo), sem expor a tabela para escrita
-- direta. A leitura da contagem é pública (o dono mostra "N visitas").
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.site_stats (
  project_id uuid primary key,
  views      bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.site_stats enable row level security;

-- Leitura pública das contagens (só números agregados, nada sensível).
drop policy if exists "site_stats read" on public.site_stats;
create policy "site_stats read" on public.site_stats for select to public using (true);

-- Incremento atômico via função com privilégio (evita escrita direta na tabela).
create or replace function public.bump_view(p uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v bigint;
begin
  insert into public.site_stats(project_id, views)
    values (p, 1)
  on conflict (project_id)
    do update set views = site_stats.views + 1, updated_at = now()
  returning views into v;
  return v;
end;
$$;

grant execute on function public.bump_view(uuid) to anon, authenticated;

select 'migracao 0008 aplicada' as resultado;
