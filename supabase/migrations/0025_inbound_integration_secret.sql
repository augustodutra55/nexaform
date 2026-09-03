-- Segredo criptografado por projeto para webhooks de entrada declarados.
alter table public.project_integration_secrets
  drop constraint if exists project_integration_secrets_provider_check;

alter table public.project_integration_secrets
  add constraint project_integration_secrets_provider_check
  check (provider in ('stripe','resend','automation','inbound'));

-- A tabela permanece inacessível aos clientes; somente service_role lê os envelopes.
revoke all on public.project_integration_secrets from anon, authenticated;
grant all on public.project_integration_secrets to service_role;
