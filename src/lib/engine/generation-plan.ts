import type { GenerationPlan } from "./app-types";

function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function compactObjective(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 240);
}

/**
 * Converte o pedido em um contrato pequeno e previsível antes da chamada à IA.
 * É propositalmente determinístico: melhora consistência sem uma segunda chamada,
 * sem custo adicional e sem consumir a janela da Vercel.
 */
export function buildGenerationPlan(message: string): GenerationPlan {
  const normalized = message.toLowerCase();
  const isSite = has(normalized, /\b(site|landing|página|pagina|institucional|portf[oó]lio|vitrine|one.?page)\b/);
  const kind: "site" | "app" = isSite ? "site" : "app";
  const requiredCapabilities: string[] = [];
  const visualDirection: string[] = [];

  if (has(normalized, /\b(login|cadastro|conta|usu[aá]rio|autentica)/)) requiredCapabilities.push("autenticação e estados de sessão");
  if (has(normalized, /\b(formul[aá]rio|lead|contato|orçamento|orcamento|agendamento)/)) requiredCapabilities.push("formulários validados com feedback visível");
  if (has(normalized, /\b(produto|estoque|cat[aá]logo|serviço|servico|cliente|crm|ve[ií]culo)/)) requiredCapabilities.push("dados reais via window.AD, com vazio/carregando/erro");
  if (has(normalized, /\b(pagamento|checkout|assinatura|preço|preco|plano)/)) requiredCapabilities.push("jornada comercial clara, sem simular pagamento real");
  if (has(normalized, /\b(áudio|audio|voz|microfone|pron[uú]ncia|falar)/)) requiredCapabilities.push("voz pelo runtime AD.voice com fallback e feedback");
  if (has(normalized, /\b(v[ií]deo|video|vsl)/)) requiredCapabilities.push("mídia em vídeo responsiva, com controles e fallback");
  if (has(normalized, /\b(3d|tr[eê]s dimens|imersiv|cinematogr[aá]fic)/)) visualDirection.push("3D ou profundidade visual somente onde trouxer impacto");
  if (has(normalized, /\b(premium|luxo|profissional|vend[aá]vel|moderno|ag[eê]ncia)/)) visualDirection.push("acabamento premium, autoral e comercial");
  if (has(normalized, /\b(anima|efeito|movimento|parallax)/)) visualDirection.push("movimento intencional e respeitando prefers-reduced-motion");

  if (!requiredCapabilities.length) requiredCapabilities.push(kind === "site" ? "navegação, CTAs e conteúdo comercial funcionais" : "fluxo principal completo e estados de interface");
  if (!visualDirection.length) visualDirection.push("hierarquia forte, responsividade e identidade coerente com o segmento");

  return {
    kind,
    objective: compactObjective(message),
    audience: has(normalized, /\b(b2b|empresa|gestor|equipe|concession[aá]ria|cl[ií]nica|escrit[oó]rio)/)
      ? "cliente empresarial e sua operação"
      : "usuário final descrito no pedido",
    requiredCapabilities,
    visualDirection,
    acceptanceCriteria: [
      "projeto multi-arquivo com App.jsx fino e imports resolvíveis",
      "fluxo principal utilizável, sem botões decorativos ou telas sem saída",
      "desktop e mobile responsivos, com acessibilidade e feedback de erro",
      "nenhuma dependência de Node ou backend inexistente no runtime gerado",
    ],
  };
}

export function renderGenerationPlan(plan: GenerationPlan): string {
  return [
    "=== CONTRATO DE GERAÇÃO (obrigatório) ===",
    `Tipo: ${plan.kind}`,
    `Objetivo: ${plan.objective}`,
    `Público: ${plan.audience}`,
    `Capacidades: ${plan.requiredCapabilities.join("; ")}`,
    `Direção visual: ${plan.visualDirection.join("; ")}`,
    `Aceite: ${plan.acceptanceCriteria.join("; ")}`,
    "Implemente e confira cada item antes de responder. Não declare concluído algo que não esteja no código.",
  ].join("\n");
}
