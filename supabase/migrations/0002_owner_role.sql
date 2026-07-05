-- ═══════════════════════════════════════════════════════════════
-- Nexaform · 0002 — role de owner com bypass total de planos
-- ═══════════════════════════════════════════════════════════════

-- 1) Campo role em profiles
alter table public.profiles
  add column if not exists role text not null default 'user'
  check (role in ('user', 'owner'));

-- 2) Configuração do email do dono (lida pelo trigger de signup).
--    Ajuste o valor abaixo para o seu email.
create table if not exists public.app_settings (
  key text primary key,
  value text not null
);
-- Sem policies: RLS ativo = inacessível a clientes; só service role/definer lê.
alter table public.app_settings enable row level security;

insert into public.app_settings (key, value)
values ('owner_email', 'augustodutra@gmail.com')
on conflict (key) do update set value = excluded.value;

-- 3) Signup: atribui role owner automaticamente se o email bater
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_owner_email text;
begin
  select value into v_owner_email from public.app_settings where key = 'owner_email';

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case
      when v_owner_email is not null and lower(new.email) = lower(v_owner_email) then 'owner'
      else 'user'
    end
  );
  insert into public.subscriptions (user_id, plan) values (new.id, 'free');
  return new;
end;
$$;

-- 4) Proteção: owner nunca é rebaixado por updates automáticos
--    (billing/webhooks só devem tocar subscriptions, nunca profiles.role).
create or replace function public.protect_owner_role()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.role = 'owner' and new.role is distinct from 'owner'
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    new.role := 'owner';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_owner on public.profiles;
create trigger profiles_protect_owner
  before update on public.profiles
  for each row execute function public.protect_owner_role();

-- 5) Promoção manual de um usuário já existente:
--    update public.profiles set role = 'owner'
--    where id = (select id from auth.users where lower(email) = lower('voce@dominio.com'));
