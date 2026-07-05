-- ═══════════════════════════════════════════════════════════════
-- Nexaform · 0003 — Studio Mode: custo real e metadados de produção
-- ═══════════════════════════════════════════════════════════════

-- Custo real (USD) e modelo de cada geração
alter table public.generations
  add column if not exists cost_usd numeric(10, 6) not null default 0,
  add column if not exists model text;

-- Metadados de produção do projeto (briefing, status, notas) em jsonb livre.
-- Mantém a arquitetura intacta: nada de novas tabelas, só um campo opcional.
alter table public.projects
  add column if not exists meta jsonb not null default '{}'::jsonb;

-- Índice para somar custo por projeto rapidamente
create index if not exists generations_project_cost_idx
  on public.generations (project_id);
