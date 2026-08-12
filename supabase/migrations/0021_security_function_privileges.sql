-- Endurecimento de privilégios de funções públicas expostas pelo PostgREST.
-- Mantém funções públicas intencionais (get_public_project e bump_view) inalteradas.

-- Funções de usuário autenticado: removem execução anônima, preservam authenticated.
revoke all on function public.finalize_generation(uuid, text, text, numeric, text) from public, anon;
grant execute on function public.finalize_generation(uuid, text, text, numeric, text) to authenticated;

revoke all on function public.finalize_generation_observed(uuid, text, text, numeric, text, integer, text, text, jsonb) from public, anon;
grant execute on function public.finalize_generation_observed(uuid, text, text, numeric, text, integer, text, text, jsonb) to authenticated;

revoke all on function public.reserve_generation(uuid, integer, text) from public, anon;
grant execute on function public.reserve_generation(uuid, integer, text) to authenticated;

revoke all on function public.reserve_generation_observed(uuid, integer, text, uuid, text) from public, anon;
grant execute on function public.reserve_generation_observed(uuid, integer, text, uuid, text) to authenticated;

revoke all on function public.workspace_access_role(uuid) from public, anon;
grant execute on function public.workspace_access_role(uuid) to authenticated;

-- Worker de fila: apenas service_role pode reivindicar trabalho.
revoke all on function public.claim_staged_generation_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_staged_generation_job(text, integer) to service_role;

-- Funções de trigger não devem ser invocadas diretamente pela API.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.protect_owner_role() from public, anon, authenticated;

-- Trigger helper com search_path imutável para evitar resolução inesperada de objetos.
alter function public.touch_updated_at() set search_path = public;
revoke all on function public.touch_updated_at() from public, anon, authenticated;

comment on function public.claim_staged_generation_job(text, integer) is
  'Worker interno de geração. Execução restrita a service_role.';
