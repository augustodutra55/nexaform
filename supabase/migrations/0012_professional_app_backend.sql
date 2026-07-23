-- ═══════════════════════════════════════════════════════════════════
-- AD Studio · Backend profissional dos aplicativos gerados
-- Papéis por usuário, contratos de dados e isolamento entre projetos.
-- ═══════════════════════════════════════════════════════════════════

alter table public.app_users
  add column if not exists role text not null default 'user';

alter table public.app_users
  drop constraint if exists app_users_role_check;
alter table public.app_users
  add constraint app_users_role_check
  check (role ~ '^[a-z][a-z0-9_-]{0,39}$');

create unique index if not exists app_users_id_project_unique
  on public.app_users (id, project_id);

create index if not exists app_users_project_role_idx
  on public.app_users (project_id, role);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'app_sessions_user_project_fk'
  ) then
    alter table public.app_sessions
      add constraint app_sessions_user_project_fk
      foreign key (user_id, project_id)
      references public.app_users(id, project_id)
      on delete cascade not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'app_data_user_project_fk'
  ) then
    alter table public.app_data
      add constraint app_data_user_project_fk
      foreign key (app_user_id, project_id)
      references public.app_users(id, project_id)
      on delete cascade not valid;
  end if;
end $$;

alter table public.app_collection_settings
  add column if not exists allowed_roles text[] not null default '{}',
  add column if not exists authenticated_scope text not null default 'own',
  add column if not exists data_contract jsonb not null default
    '{"version":1,"allowUnknown":true,"fields":{}}'::jsonb;

alter table public.app_collection_settings
  drop constraint if exists app_collection_settings_authenticated_scope_check;
alter table public.app_collection_settings
  add constraint app_collection_settings_authenticated_scope_check
  check (authenticated_scope in ('own', 'all'));

alter table public.app_collection_settings
  drop constraint if exists app_collection_settings_data_contract_check;
alter table public.app_collection_settings
  add constraint app_collection_settings_data_contract_check
  check (
    jsonb_typeof(data_contract) = 'object'
    and jsonb_typeof(coalesce(data_contract -> 'fields', '{}'::jsonb)) = 'object'
  );

alter table public.app_collection_settings
  drop constraint if exists app_collection_settings_allowed_roles_check;
alter table public.app_collection_settings
  add constraint app_collection_settings_allowed_roles_check
  check (
    cardinality(allowed_roles) <= 40
    and array_to_string(allowed_roles, ',') ~
      '^$|^[a-z][a-z0-9_-]{0,39}(,[a-z][a-z0-9_-]{0,39})*$'
  );

-- Continua sem acesso direto público. As regras acima são aplicadas pela API
-- server-side do window.AD depois de validar projeto, sessão, papel e contrato.
revoke all on public.app_users from anon, authenticated;
revoke all on public.app_sessions from anon, authenticated;
revoke all on public.app_data from anon;

select 'migracao 0012 aplicada: backend profissional por projeto' as resultado;
