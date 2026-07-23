begin;

select plan(13);

select has_column('public', 'app_users', 'role', 'app_users possui papel por projeto');
select has_column('public', 'app_collection_settings', 'allowed_roles', 'coleção possui papéis permitidos');
select has_column('public', 'app_collection_settings', 'authenticated_scope', 'coleção possui escopo autenticado');
select has_column('public', 'app_collection_settings', 'data_contract', 'coleção possui contrato de dados');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.app_users'::regclass),
  'RLS permanece ativa em app_users'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.app_sessions'::regclass),
  'RLS permanece ativa em app_sessions'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.app_data'::regclass),
  'RLS permanece ativa em app_data'
);

select ok(
  not has_table_privilege('anon', 'public.app_users', 'select'),
  'anon não lê usuários finais'
);
select ok(
  not has_table_privilege('anon', 'public.app_sessions', 'select'),
  'anon não lê sessões'
);
select ok(
  not has_table_privilege('anon', 'public.app_data', 'select'),
  'anon não lê app_data diretamente'
);

select ok(
  exists(select 1 from pg_constraint where conname = 'app_sessions_user_project_fk'),
  'sessão não pode apontar para usuário de outro projeto'
);
select ok(
  exists(select 1 from pg_constraint where conname = 'app_data_user_project_fk'),
  'registro não pode apontar para usuário de outro projeto'
);
select ok(
  exists(
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'app_collection_settings'
      and policyname = 'collection settings: dono CRUD'
  ),
  'somente o dono administra configurações de coleção'
);

select * from finish();
rollback;
