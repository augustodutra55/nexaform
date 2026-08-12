-- Histórico seguro: restaura uma versão sem perder o estado que estava aberto.
-- A operação salva o schema atual como snapshot de recuperação e troca o projeto
-- para a versão escolhida dentro da mesma transação PostgreSQL.

create or replace function public.restore_project_version(
  p_project_id uuid,
  p_version_id uuid
)
returns table (
  restored_schema jsonb,
  recovery_version_id uuid,
  restored_version_id uuid
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project public.projects%rowtype;
  v_target public.versions%rowtype;
  v_recovery_id uuid;
begin
  -- O SELECT respeita RLS e também serializa duas restaurações concorrentes.
  select *
    into v_project
    from public.projects
   where id = p_project_id
   for update;

  if not found then
    raise exception 'project_not_found_or_forbidden' using errcode = 'P0001';
  end if;

  select *
    into v_target
    from public.versions
   where id = p_version_id
     and project_id = p_project_id;

  if not found then
    raise exception 'version_not_found_or_forbidden' using errcode = 'P0001';
  end if;

  if v_project.schema is not null and v_project.schema is distinct from v_target.schema then
    insert into public.versions (project_id, schema, label)
    values (
      p_project_id,
      v_project.schema,
      'Recuperação automática · antes de restaurar ' || coalesce(nullif(v_target.label, ''), 'versão anterior')
    )
    returning id into v_recovery_id;
  end if;

  update public.projects
     set schema = v_target.schema,
         updated_at = now()
   where id = p_project_id;

  return query
  select v_target.schema, v_recovery_id, v_target.id;
end;
$$;

revoke all on function public.restore_project_version(uuid, uuid) from public;
grant execute on function public.restore_project_version(uuid, uuid) to authenticated;

comment on function public.restore_project_version(uuid, uuid) is
  'Restaura uma versão do projeto em transação única e cria antes um snapshot recuperável do estado atual.';
