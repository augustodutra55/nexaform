-- ═══════════════════════════════════════════════════════════════════
-- AD Studio · Permissões por coleção do backend window.AD
-- Fecha a RLS pública irrestrita de app_data e torna o padrão privado.
-- A API server-side passa a liberar cada operação conforme esta configuração.
-- ═══════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'app_data_project_fk'
  ) then
    -- NOT VALID preserva registros legados cujo projeto já foi removido, mas
    -- impede a criação de novos órfãos. A limpeza pode ser feita separadamente.
    alter table public.app_data
      add constraint app_data_project_fk
      foreign key (project_id) references public.projects(id) on delete cascade
      not valid;
  end if;
end $$;

alter table public.app_data
  add column if not exists app_user_id uuid references public.app_users(id) on delete cascade;

create index if not exists app_data_user_idx
  on public.app_data (project_id, collection, app_user_id, created_at);

create table if not exists public.app_collection_settings (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  collection           text not null check (char_length(collection) between 1 and 80),
  profile              text not null default 'private'
                       check (profile in ('catalog', 'form', 'authenticated', 'private', 'custom')),
  public_read          boolean not null default false,
  public_insert        boolean not null default false,
  public_update        boolean not null default false,
  public_delete        boolean not null default false,
  authenticated_read   boolean not null default false,
  authenticated_insert boolean not null default false,
  authenticated_update boolean not null default false,
  authenticated_delete boolean not null default false,
  owner_only           boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (project_id, collection)
);

create index if not exists app_collection_settings_project_idx
  on public.app_collection_settings (project_id, collection);

drop trigger if exists app_collection_settings_touch on public.app_collection_settings;
create trigger app_collection_settings_touch
  before update on public.app_collection_settings
  for each row execute function public.touch_updated_at();

alter table public.app_collection_settings enable row level security;

drop policy if exists "collection settings: dono CRUD" on public.app_collection_settings;
create policy "collection settings: dono CRUD" on public.app_collection_settings
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

grant select, insert, update, delete on public.app_collection_settings to authenticated;
revoke all on public.app_collection_settings from anon;

-- app_data deixa de ser uma tabela pública. A API window.AD usa service role
-- somente depois de validar projeto, coleção, operação e identidade do chamador.
drop policy if exists "app_data read" on public.app_data;
drop policy if exists "app_data write" on public.app_data;
drop policy if exists "app_data update" on public.app_data;
drop policy if exists "app_data delete" on public.app_data;
drop policy if exists "app_data: dono CRUD" on public.app_data;

create policy "app_data: dono CRUD" on public.app_data
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

grant select, insert, update, delete on public.app_data to authenticated;
revoke all on public.app_data from anon;

-- Backfill conservador: apenas catálogos conhecidos ganham leitura pública e
-- apenas coleções de formulário ganham inserção pública. Todo o restante fica
-- privado até o dono escolher outro perfil no painel de Dados.
insert into public.app_collection_settings (
  project_id,
  collection,
  profile,
  public_read,
  public_insert,
  owner_only
)
select distinct
  d.project_id,
  d.collection,
  case
    when lower(d.collection) in (
      'produtos', 'servicos', 'serviços', 'planos', 'depoimentos',
      'categorias', 'cardapio', 'cardápio', 'imoveis', 'imóveis',
      'itens', 'portfolio', 'portfólio'
    ) then 'catalog'
    when lower(d.collection) in (
      'contatos', 'leads', 'orcamentos', 'orçamentos', 'agendamentos',
      'mensagens', 'newsletter'
    ) then 'form'
    else 'private'
  end,
  lower(d.collection) in (
    'produtos', 'servicos', 'serviços', 'planos', 'depoimentos',
    'categorias', 'cardapio', 'cardápio', 'imoveis', 'imóveis',
    'itens', 'portfolio', 'portfólio'
  ),
  lower(d.collection) in (
    'contatos', 'leads', 'orcamentos', 'orçamentos', 'agendamentos',
    'mensagens', 'newsletter'
  ),
  not (
    lower(d.collection) in (
      'produtos', 'servicos', 'serviços', 'planos', 'depoimentos',
      'categorias', 'cardapio', 'cardápio', 'imoveis', 'imóveis',
      'itens', 'portfolio', 'portfólio', 'contatos', 'leads',
      'orcamentos', 'orçamentos', 'agendamentos', 'mensagens', 'newsletter'
    )
  )
from public.app_data d
on conflict (project_id, collection) do nothing;

select 'migracao 0009 aplicada: colecoes privadas por padrao' as resultado;
