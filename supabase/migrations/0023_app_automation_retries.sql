-- Retentativas seguras para lembretes: lease recuperável, backoff e fila indexada.
alter table public.app_automation_deliveries
  drop constraint if exists app_automation_deliveries_status_check;

alter table public.app_automation_deliveries
  add constraint app_automation_deliveries_status_check
  check (status in ('pending','processing','sent','failed','exhausted')),
  add column if not exists attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  add column if not exists next_attempt_at timestamptz default now(),
  add column if not exists lease_expires_at timestamptz;

create index if not exists app_automation_deliveries_retry_idx
  on public.app_automation_deliveries (status, next_attempt_at)
  where status in ('pending','failed');

create index if not exists app_automation_deliveries_stale_lease_idx
  on public.app_automation_deliveries (lease_expires_at)
  where status = 'processing';
