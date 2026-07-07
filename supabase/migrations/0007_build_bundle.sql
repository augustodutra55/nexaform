-- ═══════════════════════════════════════════════════════════════════
-- AD Studio · Build de produção dos apps publicados
-- Guarda o bundle JS já empacotado (esbuild) no momento da publicação, para
-- o site publicado carregar RÁPIDO: sem @babel/standalone (~3MB) e sem
-- esbuild-wasm (~8MB + compilação) no navegador do visitante. Se a coluna
-- estiver vazia (apps antigos), a página pública cai no runtime atual.
-- ═══════════════════════════════════════════════════════════════════

alter table public.projects add column if not exists build_bundle text;

select 'migracao 0007 aplicada' as resultado;
