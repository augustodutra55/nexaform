# Golden production: autenticação de serviço

A Golden Suite não depende mais de cookie de navegador. O GitHub Actions assina cada chamada com HMAC SHA-256 usando `AD_GOLDEN_SERVICE_SECRET`. A produção valida a assinatura, exige timestamp recente e só então resolve a sessão do owner no servidor.

Configuração única necessária:

1. Definir `AD_GOLDEN_SERVICE_SECRET` na Vercel para Production e Preview.
2. Definir o mesmo valor em GitHub Actions > Repository secrets.
3. Manter `OWNER_EMAIL` configurado na Vercel.

Depois disso, a suíte pode ser executada sem DevTools, sem copiar cookie e sem renovação manual de sessão.
