-- Corrige drift de privilégios em relação à fundação de segurança 0010.
-- Ambas as funções são auxiliares internas chamadas com service_role.

revoke all on function public.consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer)
  to service_role;

revoke all on function public.bump_view(uuid)
  from public, anon, authenticated;
grant execute on function public.bump_view(uuid)
  to service_role;

comment on function public.consume_rate_limit(text, integer, integer) is
  'Rate limit interno do AD Studio. Execução restrita a service_role.';
comment on function public.bump_view(uuid) is
  'Contador interno de visualizações públicas. Execução restrita a service_role.';
