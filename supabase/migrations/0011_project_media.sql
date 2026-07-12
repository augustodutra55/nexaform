-- AD Studio · Central de Mídia
-- Uploads grandes usam URL assinada e vão direto do navegador ao Supabase.
update storage.buckets
set file_size_limit = 52428800,
  allowed_mime_types = array[
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/quicktime',
    'application/pdf', 'text/plain'
  ]
where id = 'app-uploads';

select 'migracao 0011 aplicada: imagens e videos ate 50 MB' as resultado;
