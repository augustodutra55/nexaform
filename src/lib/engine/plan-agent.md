# Plan / Agent

O modo **Plan** transforma o pedido em contrato de geração, persiste o plano e não altera o projeto. O usuário pode aprovar ou cancelar. O modo **Agent** só deve executar um plano aprovado, preservando o pedido original e os critérios de aceite.

Fluxo: `draft -> approved -> executing -> completed`. Cancelamento pode ocorrer em qualquer estágio antes de concluído.

A API fica em `/api/plan/[projectId]`. Criar plano: `POST { prompt }`. Aprovar/executar/concluir/cancelar: `POST { planId, action }`.
