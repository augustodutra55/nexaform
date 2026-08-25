create index if not exists app_automation_deliveries_record_idx
  on public.app_automation_deliveries (record_id);

grant select on public.app_automation_deliveries to authenticated;

drop policy if exists "automation deliveries: owner reads" on public.app_automation_deliveries;
create policy "automation deliveries: owner reads"
  on public.app_automation_deliveries for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = (select auth.uid())
  ));
