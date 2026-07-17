import type { GenerationMediaAsset, GenerationPlan, VisualProfile, VisualProfileId } from "./app-types";

function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function compactObjective(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 240);
}

const PROFILE_COPY: Record<VisualProfileId, Omit<VisualProfile, "allowVideo">> = {
  "premium-brand": {
    id: "premium-brand",
    label: "Marca premium contemporânea",
    style: "paleta autoral do segmento, tipografia de alto contraste, fotografia contextual e acabamento sóbrio",
    layout: "hero assimétrico, seções com respiro, prova social e CTAs claros",
    motion: "subtle",
    allow3D: false,
    require3DFallback: false,
    maxExternalPackages: 3,
    performanceRules: ["anime apenas transform e opacity", "preserve conteúdo visível sem JavaScript"],
  },
  "editorial-luxury": {
    id: "editorial-luxury",
    label: "Editorial de luxo",
    style: "off-white ou tons profundos, serifada elegante, detalhes metálicos discretos e imagens amplas",
    layout: "composição editorial assimétrica, muito espaço negativo e blocos de autoridade",
    motion: "subtle",
    allow3D: false,
    require3DFallback: false,
    maxExternalPackages: 3,
    performanceRules: ["evite glows neon genéricos", "use movimento lento e discreto"],
  },
  "conversion-commerce": {
    id: "conversion-commerce",
    label: "Conversão e comércio",
    style: "contraste forte, produto/benefício em primeiro plano, confiança e preço fáceis de escanear",
    layout: "hero orientado à oferta, prova social, benefícios, comparação, FAQ e CTA recorrente",
    motion: "expressive",
    allow3D: false,
    require3DFallback: false,
    maxExternalPackages: 4,
    performanceRules: ["efeitos não podem atrasar o CTA", "carrossel deve funcionar sem autoplay obrigatório"],
  },
  "product-system": {
    id: "product-system",
    label: "Produto digital profissional",
    style: "interface limpa, tokens consistentes, densidade controlada e estados operacionais legíveis",
    layout: "shell de produto, navegação responsiva, dashboards e fluxos orientados à tarefa",
    motion: "subtle",
    allow3D: false,
    require3DFallback: false,
    maxExternalPackages: 3,
    performanceRules: ["priorize resposta imediata aos controles", "não anime tabelas ou formulários inteiros"],
  },
  "playful-learning": {
    id: "playful-learning",
    label: "Aprendizado lúdico",
    style: "cores amigáveis, formas reconhecíveis, ilustrações contextuais e reforço positivo",
    layout: "tarefas curtas, progresso visível, áreas de toque amplas e navegação simples",
    motion: "expressive",
    allow3D: false,
    require3DFallback: false,
    maxExternalPackages: 4,
    performanceRules: ["movimento nunca bloqueia a tarefa", "respeite prefers-reduced-motion"],
  },
  "immersive-3d": {
    id: "immersive-3d",
    label: "Experiência imersiva 3D",
    style: "profundidade cinematográfica, iluminação controlada e uma única cena 3D protagonista",
    layout: "hero imersivo com conteúdo HTML legível sobre ou ao lado da cena",
    motion: "expressive",
    allow3D: true,
    require3DFallback: true,
    maxExternalPackages: 5,
    performanceRules: ["uma única cena 3D", "pause render fora da viewport", "fallback CSS/imagem obrigatório", "limite devicePixelRatio a 1.5"],
  },
};

export function visualProfileFor(message: string, kind: "site" | "app"): VisualProfile {
  const normalized = message.toLowerCase();
  const wantsVideo = has(normalized, /\b(v[ií]deo|video|vsl|film|reel)\b/);
  let id: VisualProfileId;
  if (has(normalized, /\b(3d|tr[eê]s dimens|webgl|imersiv)/)) id = "immersive-3d";
  else if (has(normalized, /\b(infantil|crian[çc]|educa|curso|quiz|jogo|gamifica|aprender)/)) id = "playful-learning";
  else if (kind === "app" || has(normalized, /\b(dashboard|painel|saas|sistema|portal|crm|gest[aã]o)/)) id = "product-system";
  else if (has(normalized, /\b(venda|landing|checkout|oferta|produto|loja|e.?commerce|convers[aã]o|lan[çc]amento)/)) id = "conversion-commerce";
  else if (has(normalized, /\b(luxo|advoc|arquitet|joalher|est[eé]tica|moda|premium|boutique)/)) id = "editorial-luxury";
  else id = "premium-brand";
  return { ...PROFILE_COPY[id], allowVideo: wantsVideo };
}

/**
 * Converte o pedido em um contrato pequeno e previsível antes da chamada à IA.
 * É propositalmente determinístico: melhora consistência sem uma segunda chamada,
 * sem custo adicional e sem consumir a janela da Vercel.
 */
export function buildGenerationPlan(message: string, mediaAssets: GenerationMediaAsset[] = []): GenerationPlan {
  const normalized = message.toLowerCase();
  const isSite = has(normalized, /\b(site|landing|página|pagina|institucional|portf[oó]lio|vitrine|one.?page)\b/);
  const kind: "site" | "app" = isSite ? "site" : "app";
  const requiredCapabilities: string[] = [];
  const visualDirection: string[] = [];
  const visualProfile = visualProfileFor(message, kind);
  const imageCount = mediaAssets.filter((asset) => asset.type.indexOf("image/") === 0).length;
  const videoCount = mediaAssets.filter((asset) => asset.type.indexOf("video/") === 0).length;

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
    visualProfile,
    media: {
      imageCount,
      videoCount,
      videoMode: visualProfile.allowVideo ? (videoCount > 0 ? "uploaded" : "placeholder") : "none",
      videoUrls: mediaAssets.filter((asset) => asset.type.indexOf("video/") === 0).map((asset) => asset.url),
    },
    acceptanceCriteria: [
      "projeto multi-arquivo com App.jsx fino e imports resolvíveis",
      "fluxo principal utilizável, sem botões decorativos ou telas sem saída",
      "desktop e mobile responsivos, com acessibilidade e feedback de erro",
      "nenhuma dependência de Node ou backend inexistente no runtime gerado",
      `perfil visual ${visualProfile.label} aplicado sem comprometer o orçamento de performance`,
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
    `Perfil visual: ${plan.visualProfile.label} (${plan.visualProfile.id})`,
    `Estilo: ${plan.visualProfile.style}`,
    `Layout: ${plan.visualProfile.layout}`,
    `Motion: ${plan.visualProfile.motion}; 3D: ${plan.visualProfile.allow3D ? "permitido com fallback" : "não usar"}; vídeo: ${plan.visualProfile.allowVideo ? "solicitado" : "não inserir por conta própria"}`,
    `Mídia disponível: ${plan.media.imageCount} imagem(ns), ${plan.media.videoCount} vídeo(s); modo de vídeo: ${plan.media.videoMode}.`,
    `Orçamento: no máximo ${plan.visualProfile.maxExternalPackages} pacotes externos; ${plan.visualProfile.performanceRules.join("; ")}`,
    `Aceite: ${plan.acceptanceCriteria.join("; ")}`,
    "Implemente e confira cada item antes de responder. Não declare concluído algo que não esteja no código.",
  ].join("\n");
}
