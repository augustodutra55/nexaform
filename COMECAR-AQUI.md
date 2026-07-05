# Nexaform — pronto para uso 🚀

O backend real **já está provisionado e testado**. Você só precisa rodar o app na sua máquina.

## Backend (já configurado por mim)

- **Projeto Supabase:** `nexaform` (org pessoal, plano Free)
- **URL:** `https://zrkmbzokyupqdiwxgvcv.supabase.co`
- **Migrações aplicadas:** todas as 11 tabelas + RLS + role de owner (0001 e 0002)
- **Auth:** signup por email/senha ativado, confirmação de email **desligada** (login imediato), `localhost:3000` já liberado nas Redirect URLs
- **`owner_email`** = `augustodutra@gmail.com` → sua conta vira **owner** automaticamente
- O arquivo **`.env.local`** já está preenchido com a URL e a chave pública

## Sua conta owner

Já criei sua conta durante os testes:

- **Email:** `augustodutra@gmail.com`
- **Senha temporária:** _(enviada na mensagem do chat — troque em Settings → Redefinir senha)_

Se preferir, use "Esqueci a senha" na tela de login para definir uma nova.

## Rodar o app (3 comandos)

```bash
cd nexaform
npm install
npm run dev
```

Abra **http://localhost:3000**, faça login e pronto. O motor de IA local (grátis) já
funciona sem nenhuma chave; para gerações mais inteligentes, conecte uma chave da
Anthropic/OpenRouter em Settings.

## O que já testei no backend real (tudo ✅)

| Teste | Resultado |
|---|---|
| Signup `augustodutra@gmail.com` | conta criada |
| Atribuição automática de role | `role = owner` |
| Assinatura do usuário | permanece `free` (bypass é por role, não muda plano) |
| Criar 5 projetos (limite Free = 3) | 5 criados, sem bloqueio |
| Publicação + link público | publicado; leitura anônima do `/p/[slug]` OK |
| Gerações além da cota (35 > 30) | 35 registradas, sem bloqueio |
| Versão / export JSON | versão criada; schema exportável |

Depois limpei os dados de teste — sua conta começa **zerada e limpa**.

> Observação técnica: não consigo manter o `npm run dev` rodando na sua máquina a
> partir daqui (rodo num sandbox isolado). Por isso deixei o backend 100% pronto e
> os 3 comandos acima para você subir o front localmente.
