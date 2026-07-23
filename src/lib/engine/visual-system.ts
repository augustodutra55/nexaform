import type { VisualBlueprint, VisualProfile } from "./app-types";

interface SegmentDirection {
  id: string;
  label: string;
  cue: string;
  palette: string;
  media: string;
}

const SEGMENTS: { pattern: RegExp; direction: SegmentDirection }[] = [
  {
    pattern: /\b(carro|autom[oó]vel|ve[ií]culo|concession[aá]ria|oficina|mec[aâ]nic)/,
    direction: {
      id: "automotive",
      label: "automotivo",
      cue: "precisão mecânica, confiança pós-venda e sensação de movimento controlado",
      palette: "grafite e azul profundo, com um acento elétrico ou verde de status",
      media: "veículos reais, detalhes de acabamento e oficina limpa com luz direcional",
    },
  },
  {
    pattern: /\b(cl[ií]nica|sa[uú]de|m[eé]dic|odont|dent|est[eé]tica|terapia|hospital)/,
    direction: {
      id: "health",
      label: "saúde",
      cue: "acolhimento humano, segurança clínica e clareza sem aparência hospitalar fria",
      palette: "marfim e azul-petróleo ou verde profundo, com acento quente discreto",
      media: "profissionais e pacientes em situação real, ambiente limpo e luz natural",
    },
  },
  {
    pattern: /\b(advoc|jur[ií]dic|escrit[oó]rio|cont[aá]bil|consultoria)/,
    direction: {
      id: "professional-services",
      label: "serviços profissionais",
      cue: "autoridade serena, discrição e organização editorial",
      palette: "azul-noite ou carvão, marfim e detalhe cobre ou dourado dessaturado",
      media: "pessoas reais em contexto de decisão, arquitetura sóbria e detalhes materiais",
    },
  },
  {
    pattern: /\b(caf[eé]|cafeteria|restaurante|comida|gastronom|padaria|confeitaria|card[aá]pio)/,
    direction: {
      id: "food",
      label: "gastronomia",
      cue: "sensorialidade, origem artesanal e desejo imediato pelo produto",
      palette: "cacau, creme e terracota ou verde-oliva como acento",
      media: "close editorial do produto, textura real e luz quente de janela",
    },
  },
  {
    pattern: /\b(im[oó]vel|imobili[aá]ria|arquitet|construtora|interior|decor)/,
    direction: {
      id: "architecture",
      label: "arquitetura e imóveis",
      cue: "escala, materialidade e sofisticação espacial",
      palette: "pedra, areia e carvão com um acento natural do projeto",
      media: "ambientes amplos, linhas arquitetônicas e materiais fotografados sem distorção",
    },
  },
  {
    pattern: /\b(academia|fitness|treino|esporte|personal|corrida|crossfit)/,
    direction: {
      id: "fitness",
      label: "fitness",
      cue: "energia disciplinada, progresso mensurável e ação",
      palette: "carvão e branco, com acento lima, coral ou azul intenso",
      media: "movimento atlético verdadeiro, expressão focada e iluminação contrastada",
    },
  },
  {
    pattern: /\b(educa|curso|escola|ingl[eê]s|aprender|aula|professor|infantil|crian[çc])/, 
    direction: {
      id: "education",
      label: "educação",
      cue: "curiosidade, progresso visível e baixa carga cognitiva",
      palette: "azul luminoso, violeta e cores de feedback sobre fundos claros ou noturnos suaves",
      media: "situações de aprendizagem reconhecíveis e ilustrações coerentes com cada tarefa",
    },
  },
  {
    pattern: /\b(saas|software|tecnologia|startup|dashboard|crm|sistema|plataforma)/,
    direction: {
      id: "technology",
      label: "tecnologia",
      cue: "produto confiável, dados legíveis e profundidade digital sem neon genérico",
      palette: "ardósia, branco e uma única cor de ação bem contrastada",
      media: "mockups funcionais do produto, pessoas usando tecnologia e diagramas simples",
    },
  },
];

const DEFAULT_SEGMENT: SegmentDirection = {
  id: "general",
  label: "marca contemporânea",
  cue: "personalidade do segmento, confiança e uma narrativa visual clara",
  palette: "uma base neutra, uma cor dominante do segmento e um único acento de ação",
  media: "fotografia contextual específica do conteúdo, com pessoas e ambientes verossímeis",
};

function segmentFor(message: string): SegmentDirection {
  const normalized = message.toLowerCase();
  const match = SEGMENTS.find((item) => item.pattern.test(normalized));
  return match?.direction ?? DEFAULT_SEGMENT;
}

function compositionsFor(profile: VisualProfile, kind: "site" | "app"): string[] {
  if (kind === "app" || profile.id === "product-system") {
    return [
      "shell responsivo com navegação realmente funcional e uma ação primária inequívoca",
      "visão geral com informação prioritária, estado vazio útil e atalho para o fluxo principal",
      "fluxos operacionais em painéis focados; tabelas, formulários e métricas não dividem a mesma hierarquia",
    ];
  }
  if (profile.id === "conversion-commerce") {
    return [
      "hero de oferta assimétrico com produto, promessa verificável e CTA visível sem rolar",
      "sequência benefício → prova → objeção → oferta, alternando ritmos em vez de repetir grades",
      "comparação ou demonstração visual antes do CTA final; FAQ apenas para objeções reais",
    ];
  }
  if (profile.id === "editorial-luxury") {
    return [
      "abertura editorial assimétrica com headline curta e uma imagem protagonista",
      "blocos de autoridade com espaço negativo, recortes de imagem e tipografia em escala",
      "prova e CTA final em composição contida, sem cards repetidos ou brilho artificial",
    ];
  }
  if (profile.id === "playful-learning") {
    return [
      "tarefa principal imediatamente reconhecível, progresso persistente e próxima ação explícita",
      "blocos curtos com feedback positivo e áreas de toque amplas",
      "recompensa visual discreta após ação, nunca antes de o conteúdo estar utilizável",
    ];
  }
  if (profile.id === "immersive-3d") {
    return [
      "hero dividido entre conteúdo HTML legível e uma única cena 3D protagonista",
      "seções seguintes leves em HTML/CSS que explicam valor, prova e chamada comercial",
      "fallback estático visualmente equivalente, disponível antes de carregar WebGL",
    ];
  }
  return [
    "hero assimétrico com uma imagem protagonista, mensagem específica e CTA claro",
    "narrativa alternada entre autoridade, benefício e prova, evitando três cards idênticos",
    "fechamento comercial curto com garantia, contato ou próximo passo verificável",
  ];
}

/**
 * Cria um sistema visual repetível sem uma chamada extra de IA. O resultado
 * combina o perfil de produto com o segmento, evitando layouts aleatórios.
 */
export function buildVisualBlueprint(
  message: string,
  kind: "site" | "app",
  profile: VisualProfile
): VisualBlueprint {
  const segment = segmentFor(message);
  return {
    id: `${profile.id}-${segment.id}`,
    segment: segment.label,
    signature: `${segment.cue}; escolha um único motivo visual reconhecível e repita-o com moderação`,
    palette: segment.palette,
    typography: profile.id === "editorial-luxury"
      ? "serifada expressiva apenas em títulos + sans legível em interface e corpo"
      : "sans de alta legibilidade, com contraste de peso e escala em vez de muitas fontes",
    surface: kind === "app"
      ? "tokens consistentes para canvas, painel, borda, texto, ação, sucesso, aviso e erro"
      : "profundidade por contraste, recorte e sobreposição; não transforme toda seção em card",
    compositions: compositionsFor(profile, kind),
    mediaTreatment: [
      `${segment.media}; cada imagem deve corresponder ao título do bloco`,
      "hero 16:9 ou 3:2; cards 4:3; retratos 3:4; sempre object-cover em contêiner de proporção fixa",
      "primeira imagem pode carregar imediatamente; imagens abaixo da dobra usam loading=\"lazy\" e decoding=\"async\"",
      "vídeo usa poster contextual, controls, playsInline e preload=\"metadata\"; nunca autoplay com som",
    ],
    motionRecipe: [
      profile.motion === "expressive"
        ? "entrada curta em cascata apenas no primeiro encontro; hover confirma interação com transform/opacity"
        : "entrada sutil e rápida; hover somente em elementos interativos",
      "duração entre 160–500ms, easing consistente e nenhum conteúdo começa invisível sem fallback",
      "motion-reduce ou prefers-reduced-motion remove deslocamentos e animações contínuas",
    ],
    threeDRecipe: profile.allow3D
      ? [
          "uma única cena, isolada em componente próprio e sem bloquear o conteúdo HTML",
          "DPR máximo 1.5, pause fora da viewport e controles limitados ao propósito",
          "fallback imagem/CSS equivalente para mobile, WebGL indisponível e carregamento",
        ]
      : ["não importar Three; use perspectiva CSS, camadas e mídia contextual para profundidade"],
  };
}
