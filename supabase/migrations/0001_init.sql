-- ═══════════════════════════════════════════════════════════════
-- Alvor · migração inicial
-- Rode este arquivo no SQL Editor do Supabase (ou via supabase db push)
-- ═══════════════════════════════════════════════════════════════

-- ── profiles ────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── subscriptions ───────────────────────────────────────────────
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro', 'team')),
  status text not null default 'active' check (status in ('active', 'past_due', 'canceled')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id)
);

-- ── usage_limits (visão consolidada de limites por usuário) ─────
create table if not exists public.usage_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null default date_trunc('month', now())::date,
  generations_used int not null default 0,
  projects_count int not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, period_start)
);

-- ── projects ────────────────────────────────────────────────────
-- `schema` guarda o component tree completo (fonte da verdade do runtime).
-- As tabelas normalizadas abaixo (project_pages/sections/components)
-- são sincronizadas para consulta/busca/analytics.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  schema jsonb,
  published boolean not null default false,
  share_slug text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_idx on public.projects (user_id, updated_at desc);
create index if not exists projects_slug_idx on public.projects (share_slug) where published;

-- ── project_pages ───────────────────────────────────────────────
create table if not exists public.project_pages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  node_id text not null,           -- id do nó no schema jsonb
  name text not null,
  path text not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (project_id, node_id)
);

-- ── project_sections ────────────────────────────────────────────
create table if not exists public.project_sections (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.project_pages(id) on delete cascade,
  node_id text not null,
  type text not null,
  props jsonb not null default '{}'::jsonb,
  position int not null default 0,
  unique (page_id, node_id)
);

-- ── components (biblioteca de componentes reutilizáveis) ────────
create table if not exists public.components (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  type text not null,
  props jsonb not null default '{}'::jsonb,
  is_global boolean not null default false, -- templates do sistema
  created_at timestamptz not null default now()
);

-- ── chat_threads ────────────────────────────────────────────────
create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (project_id)
);

-- ── chat_messages ───────────────────────────────────────────────
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_thread_idx on public.chat_messages (thread_id, created_at);

-- ── generations (log de uso do motor de IA) ─────────────────────
create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  prompt text,
  provider text not null default 'local',
  status text not null default 'completed' check (status in ('pending', 'completed', 'failed')),
  created_at timestamptz not null default now()
);
create index if not exists generations_user_month_idx on public.generations (user_id, created_at);

-- ── versions (snapshots do schema) ──────────────────────────────
create table if not exists public.versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  label text,
  schema jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists versions_project_idx on public.versions (project_id, created_at desc);

-- ═══════════════════════════════════════════════════════════════
-- Trigger: cria profile + subscription free no signup
-- ═══════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  insert into public.subscriptions (user_id, plan) values (new.id, 'free');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Trigger updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- Row Level Security
-- ═══════════════════════════════════════════════════════════════
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_limits enable row level security;
alter table public.projects enable row level security;
alter table public.project_pages enable row level security;
alter table public.project_sections enable row level security;
alter table public.components enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.generations enable row level security;
alter table public.versions enable row level security;

-- profiles
create policy "profiles: dono lê" on public.profiles for select using (auth.uid() = id);
create policy "profiles: dono edita" on public.profiles for update using (auth.uid() = id);

-- subscriptions / usage_limits (somente leitura pelo dono; escrita via service role)
create policy "subs: dono lê" on public.subscriptions for select using (auth.uid() = user_id);
create policy "usage: dono lê" on public.usage_limits for select using (auth.uid() = user_id);

-- projects
create policy "projects: dono CRUD" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "projects: público lê publicados" on public.projects
  for select using (published = true);

-- project_pages / project_sections (via projeto do dono)
create policy "pages: dono CRUD" on public.project_pages for all
  using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));
create policy "sections: dono CRUD" on public.project_sections for all
  using (exists (
    select 1 from public.project_pages pg
    join public.projects p on p.id = pg.project_id
    where pg.id = page_id and p.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.project_pages pg
    join public.projects p on p.id = pg.project_id
    where pg.id = page_id and p.user_id = auth.uid()
  ));

-- components
create policy "components: dono CRUD" on public.components
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "components: globais legíveis" on public.components
  for select using (is_global = true);

-- chat
create policy "threads: dono CRUD" on public.chat_threads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "messages: dono CRUD" on public.chat_messages for all
  using (exists (select 1 from public.chat_threads t where t.id = thread_id and t.user_id = auth.uid()))
  with check (exists (select 1 from public.chat_threads t where t.id = thread_id and t.user_id = auth.uid()));

-- generations
create policy "generations: dono lê" on public.generations for select using (auth.uid() = user_id);
create policy "generations: dono insere" on public.generations for insert with check (auth.uid() = user_id);

-- versions
create policy "versions: dono CRUD" on public.versions for all
  using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));
