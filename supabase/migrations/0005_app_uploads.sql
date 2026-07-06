-- ═══════════════════════════════════════════════════════════════════
-- AD Studio · Storage de uploads dos apps gerados
-- Bucket público "app-uploads"; os arquivos são organizados por project_id
-- (prefixo no caminho). A API server-side impõe o escopo e os limites.
-- ═══════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('app-uploads', 'app-uploads', true)
on conflict (id) do update set public = true;

-- Leitura pública e escrita pública (papel public = anon + authenticated).
-- A API server-side impõe o prefixo project_id/ e os limites de tamanho/tipo.
drop policy if exists "app_uploads read" on storage.objects;
drop policy if exists "app_uploads write" on storage.objects;

create policy "app_uploads read"
  on storage.objects for select to public
  using (bucket_id = 'app-uploads');

create policy "app_uploads write"
  on storage.objects for insert to public
  with check (bucket_id = 'app-uploads');

select 'migracao 0005 aplicada' as resultado;
