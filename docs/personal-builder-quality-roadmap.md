# AD Studio — construtor pessoal de apps comercializáveis

O construtor é ferramenta pessoal do Dr. Augusto. O produto vendido é cada aplicativo/site, não o acesso ao AD Studio. Não criar cobrança de plataforma, marketplace ou gestão de assinantes como parte deste plano.

## Primeira entrega: impedir regressões silenciosas

- Carregar o contrato cumulativo persistido antes de gerar/refinar: geração síncrona, streaming e worker.
- Se o contexto do banco falhar, parar antes de reservar/iniciar geração paga.
- Comparar módulos alcançáveis da versão anterior e candidata. Comentários, strings e arquivos órfãos não comprovam retenção.
- Bloquear perda de operações AD, disponibilidade da agenda, contratos/campos, automações, ações, webhooks, preços e superfícies de mídia.
- Não rebaixar essas perdas para avisos em etapas intermediárias. A candidata reprovada não substitui o snapshot anterior.
- Respeitar remoções explicitamente dirigidas ao recurso. Ampliar acesso a dados permanece uma alteração que exige revisão específica.

Limite: análise estática é uma barreira adicional, não prova de equivalência funcional nem substituto de testes no navegador. Não detecta toda regressão de interface ou regra de negócio.

## Próximos marcos de qualidade

| Prioridade | Resultado para uso pessoal/comercial | Prova de aceite |
| --- | --- | --- |
| 1 | Base de dependências sem vulnerabilidades altas conhecidas | Audit verde, build e testes visuais; sem relaxar o gate |
| 2 | Procedimentos → profissional → horário → confirmação | Jornada odontológica real em desktop/mobile; conflito bloqueado e persistência após recarregar |
| 3 | Imagens e vídeos reutilizáveis, sem gerar novamente em edição de texto | URL/arquivo existente retido, tentativa/custo registrados, vídeo somente com confirmação |
| 4 | Entrega com marca do cliente, domínio e exportação | ZIP/código íntegro, instruções de backend/segredos, teste de publicação e restauração |
| 5 | Comparação repetível com Lovable | Mesmo conjunto de prompts e jornadas, notas de sucesso, tempo, custo e perdas por refinamento |

## Benchmark honesto

Lovable documenta testes no navegador/frontend/backend e histórico de versões. Logo, presença dessas funções isoladas não demonstra superioridade. Comparar apps equivalentes com requisitos iguais e evidências verificáveis.

Referências oficiais consultadas em 2026-10-11:
- https://docs.lovable.dev/features/testing
- https://docs.lovable.dev/features/browser-testing
- https://docs.lovable.dev/features/projects/history

## Segurança e migração da ferramenta de estilos

Braces 3.0.3 (dependência da cadeia de construção Tailwind 3) tinha aviso alto sem versão corrigida publicada. A migração autorizada para Tailwind 4.3.3 substitui essa cadeia de dependências; não suprime o alerta nem retira o audit do CI. A auditoria local em 2026-10-12 reportou zero vulnerabilidades conhecidas.

Atualizações preparadas nesta entrega: Next 15.5.27, Sharp 0.35.5, source-map-js 1.2.2, Tailwind/PostCSS 4.3.3 e tailwind-merge 3.7.0. Tema, sombras, foco, cores da marca e largura do container preservados explicitamente. O compilador do Studio muda; o runtime CSS dos apps já gerados mantém sua compatibilidade.

A revisão da migração exige build, auditoria, testes de contrato e testes de interação. Um job separado compara a referência Tailwind 3 com a nova versão em 390, 1440 e 1920px, nos temas claro/escuro, com diálogos, cores, dimensões e espaçamentos. As capturas incluem as páginas públicas inicial e login. Os testes de componentes permanecem nos próximos CIs. Essa amostra não cobre toda tela ou funcionalidade dos apps gerados.

A geração Golden paga não é executada por esta entrega. Não declarar superioridade sobre outros construtores com base apenas nesta migração.
