# Streaming SSE do chat e da geração

O AD Studio transmite a geração de código em tempo real por Server-Sent Events.
As rotas consomem o motor existente (`src/lib/engine/code-providers.ts`) e o
mesmo chain de fallback de modelos (`src/lib/engine/models.ts`); apenas o
transporte muda.

## Rotas

- `POST /api/chat` — geração/refinamento simples. Corpo: `{ projectId, prompt }`
  (aceita também `message`, `currentFiles`, `currentCode`, `name`, `userKey`,
  `userProvider`, `costMode`, `attachments`). Sem chave OpenRouter disponível,
  degrada para a geração síncrona (Anthropic direta) e emite só `result`/`done`.
- `POST /api/chat/stream` — construção/refinamento POR ETAPAS. Mesmo corpo;
  usa as etapas de `staged-generation.ts` e emite um ciclo de eventos por etapa.
  Exige chave OpenRouter (do usuário ou `OPENROUTER_API_KEY`).

## Protocolo de eventos

| Evento         | Payload                                          | Quando |
|----------------|--------------------------------------------------|--------|
| `model`        | `{"model":"...","attempt":1}`                    | início de cada tentativa do chain de fallback |
| `token`        | `{"t":"..."}`                                    | cada delta de texto do modelo |
| `stage`        | `{"index":1,"total":7,"label":"..."}`            | só em `/api/chat/stream`, início da etapa |
| `stage-result` | `AppGenerationResult` da etapa                   | só em `/api/chat/stream`, etapa validada pelo quality gate |
| `result`       | `AppGenerationResult` + `projectCost`            | só em `/api/chat`, resultado final |
| `error`        | `{"error":"...","fallbackCard":true?,"stage":N?}`| falha; `fallbackCard` = todos os modelos falharam |
| `done`         | `{}` ou `{"stages":N}`                           | fim do stream, sempre emitido |

Erros de autenticação, limite de plano, reserva e validação chegam ANTES do
stream, como JSON convencional (`401/402/403/409/422/429/503`).

## Como testar com curl

```bash
# Cookie de sessão Supabase válido (copie do navegador logado):
COOKIE='sb-<ref>-auth-token=...'

curl -N -X POST https://<host>/api/chat \
  -H "content-type: application/json" -H "cookie: $COOKIE" \
  -d '{"projectId":"<uuid>","prompt":"Deixe o título maior","currentFiles":[...],"userProvider":"openrouter","userKey":"sk-or-..."}'

curl -N -X POST https://<host>/api/chat/stream \
  -H "content-type: application/json" -H "cookie: $COOKIE" \
  -d '{"projectId":"<uuid>","prompt":"Sistema de agendamento para esmalteria com painel admin"}'
```

`-N` desliga o buffering do curl; os `event:`/`data:` devem aparecer em tempo
real, terminando com `event: done`.

## Comportamento no painel

`chat-panel.tsx` tenta `/api/chat` primeiro em toda geração real não-etapada e
mostra a cauda dos tokens no indicador "Escrevendo o código…". Se a rota não
responder com `text/event-stream` (chave Anthropic, deploy antigo, rede), o
painel cai automaticamente no caminho síncrono `/api/generate-app`, sem mudança
de comportamento. O pipeline de imagens ADIMG ainda não roda em `/api/chat`.
