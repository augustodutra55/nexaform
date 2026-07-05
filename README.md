# Nexaform — do prompt ao produto

Plataforma de IA que transforma **linguagem natural em apps, sites e dashboards**: o usuário descreve o que quer em um chat, o sistema interpreta o pedido, gera a estrutura em um schema de componentes e renderiza o **preview em tempo real**, com refinamento incremental, versões, publicação e exportação.

Brand assets em `public/brand/`: `logo.svg` (lockup), `logo-mark.svg` (monograma), `favicon.svg`, `app-icon.svg`.

Stack: **Next.js (App Router) · React · TypeScript · Tailwind CSS · shadcn/ui (componentes próprios no mesmo padrão) · Supabase**.

---

## 1. Arquitetura

> A geração por schema abaixo é a espinha dorsal do produto e está **congelada**: banco, engine, versões e rotas principais não mudam entre rebrands.

### Geração por schema (component tree), não por código

O coração do produto é o pipeline em `src/lib/engine/`:

```
prompt do usuário
   │
   ▼
1. Interpretação de intenção        (tipo de projeto, tema, cores)
   │
   ▼
2. Schema estruturado (AppSchema)   { name, theme, pages[ { sections[ {type, props} ] } ] }
   │
   ▼
3. Renderização do preview          SectionRenderer mapeia type → componente React
   │
   ▼
4. Refinamento incremental          novos prompts MUTAM o schema (não regeneram tudo)
   │
   ▼
5. Versionamento                    cada geração vira um snapshot em `versions`
```

Vantagens: geração barata (poucos tokens ou zero), preview instantâneo, undo/redo e diffs triviais (é só JSON), e o mesmo schema serve para publicar, exportar e renderizar.

### Provedores de IA plugáveis (com fallback automático)

`src/lib/engine/providers.ts` resolve nesta ordem:

1. **Chave do usuário** (configurada em Settings; fica só no navegador) — Claude ou OpenRouter
2. `ANTHROPIC_API_KEY` do ambiente
3. `OPENROUTER_API_KEY` do ambiente
4. **Motor local** (`local.ts`) — determinístico, por templates e heurísticas. Sempre disponível: é o modo demo/uso gratuito.

Qualquer falha de rede ou parse cai para o próximo nível. Há rate-limit por usuário no servidor (`GENERATION_RATE_LIMIT`, default 20/h) além do limite mensal do plano, verificado contra a tabela `generations`.

> Nota: o rate-limit em memória é por instância. Em produção serverless, troque por um contador no Postgres/Redis.

### Estado do editor

`src/lib/store/project.ts` (Zustand) guarda o schema com pilhas de **undo/redo**, página ativa, seção selecionada e estado de salvamento. O **autosave** (debounce de 1,2s) persiste o schema em `projects.schema`; cada geração insere um snapshot em `versions`.

---

## 2. Estrutura de pastas

```
nexaform/
├── public/brand/                       # logo.svg, logo-mark.svg, favicon.svg, app-icon.svg
├── supabase/migrations/0001_init.sql   # todas as tabelas + RLS + triggers
├── supabase/migrations/0002_owner_role.sql  # role owner + bypass de planos
├── src/
│   ├── middleware.ts                   # sessão Supabase + rotas protegidas
│   ├── app/
│   │   ├── layout.tsx  globals.css     # raiz, temas dark/light, tokens
│   │   ├── page.tsx                    # landing page
│   │   ├── pricing/page.tsx
│   │   ├── (auth)/
│   │   │   ├── login/  cadastro/  recuperar-senha/  redefinir-senha/
│   │   ├── (app)/                      # rotas protegidas
│   │   │   ├── dashboard/              # lista/cria/renomeia/duplica/exclui projetos
│   │   │   ├── onboarding/             # primeiro uso guiado
│   │   │   ├── settings/               # perfil, provedor de IA, plano e uso
│   │   │   └── projeto/[id]/           # chat + preview + editor
│   │   ├── p/[slug]/                   # preview público (projeto publicado)
│   │   ├── auth/callback/route.ts      # troca de código (magic link/reset)
│   │   └── api/generate/route.ts       # endpoint de geração (auth + limites)
│   ├── components/
│   │   ├── ui/                         # design system (padrão shadcn/ui)
│   │   ├── brand/logo.tsx              # marca original "Alvor"
│   │   ├── marketing/site-shell.tsx    # header/footer do site
│   │   ├── app/header.tsx              # topo da área logada
│   │   ├── project/                    # chat-panel, editor-panel, topbar
│   │   └── preview/                    # preview-pane, section-renderer
│   └── lib/
│       ├── engine/                     # types, local, providers, prompts
│       ├── store/project.ts            # Zustand (undo/redo/autosave)
│       ├── supabase/                   # client, server, middleware
│       ├── plans.ts                    # Free / Pro / Team + limites
│       ├── access.ts                   # isOwner / hasPaidAccess / resolvePlan
│       └── utils.ts
```

---

## 3. Modelagem do banco (Supabase)

Tudo em `supabase/migrations/0001_init.sql`, com **RLS em todas as tabelas**:

| Tabela | Papel |
|---|---|
| `profiles` | dados do usuário (criado via trigger no signup) |
| `subscriptions` | plano do usuário (`free`/`pro`/`team`) — criado no signup |
| `usage_limits` | consolidação de uso por período (para relatórios/cobrança) |
| `projects` | projeto com `schema` jsonb (fonte da verdade do runtime), `published`, `share_slug` |
| `project_pages` / `project_sections` | espelho normalizado do schema para busca/analytics |
| `components` | biblioteca de componentes reutilizáveis (globais e do usuário) |
| `chat_threads` / `chat_messages` | histórico da conversa por projeto |
| `generations` | log de cada geração (base do limite mensal por plano) |
| `versions` | snapshots do schema (histórico de versões restaurável) |

Políticas principais: dono tem CRUD nos próprios dados; `projects` publicados são legíveis anonimamente (rota `/p/[slug]`); `subscriptions`/`usage_limits` são somente leitura para o cliente (escrita via service role/backoffice).

---

## 4. Rodando o projeto

### Pré-requisitos
- Node 18+
- Um projeto no [Supabase](https://supabase.com) (grátis)

### Passos

```bash
# 1. Instale as dependências
npm install

# 2. Configure o ambiente
cp .env.example .env.local
# preencha NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY
# (Supabase → Settings → API)

# 3. Crie o banco
# Abra o SQL Editor do Supabase e execute, em ordem:
#   supabase/migrations/0001_init.sql
#   supabase/migrations/0002_owner_role.sql  (ajuste o owner_email no arquivo)

# 4. (Opcional) IA premium
# Adicione ANTHROPIC_API_KEY ou OPENROUTER_API_KEY ao .env.local.
# Sem chave nenhuma, o motor local assume — o app funciona 100% offline de IA.

# 5. Rode
npm run dev
# → http://localhost:3000
```

No Supabase, em **Authentication → URL Configuration**, adicione `http://localhost:3000/auth/callback` às Redirect URLs (necessário para recuperação de senha).

### Fluxo de teste rápido
1. Crie uma conta em `/cadastro` → onboarding.
2. Descreva algo como *“Crie uma landing page para minha cafeteria com preços e FAQ”*.
3. Veja o preview nascer; refine: *“mude a cor para azul”*, *“adicione depoimentos”*, *“crie uma página Sobre”*.
4. Edite textos/tema no painel direito; use ⌘Z / ⌘⇧Z.
5. Publique e abra o link `/p/…` em uma aba anônima.

---

## 5. Planos e limites

| | Free | Pro | Team |
|---|---|---|---|
| Projetos | 3 | ∞ | ∞ |
| Gerações/mês | 30 | 500 | 3.000 |
| Exportação | — | ✓ | ✓ |
| Colaboração/permissões | — | — | ✓ |

Os limites são aplicados no servidor (`/api/generate`) e no cliente (criação de projetos, exportação). A troca de plano é feita alterando `subscriptions.plan` (integração de billing — ex.: Stripe — é o próximo passo natural).

### Owner bypass

Contas com role `owner` (em `profiles.role`) ou com email listado em `OWNER_EMAIL`/`NEXT_PUBLIC_OWNER_EMAIL` têm **acesso total a Pro e Team sem pagamento**: sem limite de projetos, gerações, exportação, publicação ou colaboração, ignorando `subscriptions` e `usage_limits`. A regra vive em um único módulo (`src/lib/access.ts` — `isOwner()`, `hasPaidAccess()`, `resolvePlan()`) e é aplicada no servidor (`/api/generate`) e no cliente (dashboard, exportação, settings). O signup atribui `owner` automaticamente quando o email bate com `app_settings.owner_email` (migração `0002`), e um trigger impede rebaixamento automático da role. Billing futuro (Stripe) só toca `subscriptions.plan` — nunca a role.

Para promover manualmente um usuário existente:

```sql
update public.profiles set role = 'owner'
where id = (select id from auth.users where lower(email) = lower('voce@dominio.com'));
```

---

## 6. Identidade

**Nexaform** (*nexus* + *form*): conexão que ganha forma — prompts que viram produto. O símbolo é um monograma geométrico em **N** contido num frame de aplicativo cuja cauda o transforma, sutilmente, num balão de conversa: software que nasce de um diálogo. Vetorial, flat e legível de 16 px (favicon) a 512 px (app icon), sem clichês visuais de IA.

Paleta: fundo `#0B1020`, primária `#635BFF`, apoio `#8B5CF6`, neutros `#F8FAFC` / `#94A3B8`. Wordmark em Inter semibold com tracking reduzido. Tokens completos em `src/app/globals.css` e escala `brand` no `tailwind.config.ts`. Microcopy, visual e assets são 100% originais.
