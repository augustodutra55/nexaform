import type { GenerationMediaAsset } from "./app-types";

export interface GoldenCase {
  id: "landing" | "agenda" | "dashboard" | "commerce" | "media";
  name: string;
  prompt: string;
  expectedKind: "site" | "app";
  expectedProfile: "conversion-commerce" | "product-system" | "premium-brand" | "editorial-luxury";
  requiredCapabilities: string[];
  mediaAssets?: GenerationMediaAsset[];
  expectedVideoMode?: "none" | "placeholder" | "uploaded";
}

/**
 * Casos fixos usados como regressão de paridade. O texto é deliberadamente
 * representativo de pedidos comerciais reais, sem depender de um cliente
 * específico ou de conteúdo privado.
 */
export const GOLDEN_CASES: GoldenCase[] = [
  {
    id: "landing",
    name: "Landing de serviço premium",
    prompt: "Crie uma landing page profissional e vendável para uma consultoria empresarial, com hero forte, benefícios, prova social, formulário de contato, FAQ e CTA recorrente. Visual premium, moderno e responsivo.",
    expectedKind: "site",
    expectedProfile: "conversion-commerce",
    requiredCapabilities: ["formulários validados com feedback visível"],
    expectedVideoMode: "none",
  },
  {
    id: "agenda",
    name: "Agenda SaaS",
    prompt: "Crie um app SaaS de agendamento para uma clínica: login, cadastro, agenda por dia e horário e CRUD completo de clientes com listagem, criação, edição e exclusão real com confirmação; inclua também confirmação, reagendamento, cancelamento e estados de vazio, carregando e erro. Precisa funcionar bem no celular.",
    expectedKind: "app",
    expectedProfile: "product-system",
    requiredCapabilities: [
      "autenticação e estados de sessão",
      "formulários validados com feedback visível",
      "dados reais via window.AD, com vazio/carregando/erro",
      "CRUD completo em uma coleção autenticada: leitura, criação, edição e exclusão",
    ],
    expectedVideoMode: "none",
  },
  {
    id: "dashboard",
    name: "Dashboard operacional",
    prompt: "Crie um dashboard de gestão B2B para equipe comercial com KPIs, clientes, funil, tarefas, filtros e navegação responsiva. Deve ser um sistema profissional, rápido, com estados operacionais claros e sem botões decorativos.",
    expectedKind: "app",
    expectedProfile: "product-system",
    requiredCapabilities: ["dados reais via window.AD, com vazio/carregando/erro"],
    expectedVideoMode: "none",
  },
  {
    id: "commerce",
    name: "E-commerce orientado à conversão",
    prompt: "Crie um site e-commerce para produtos de cuidado pessoal, com catálogo, cards de produto, busca, benefícios, preço, carrinho demonstrativo, jornada de checkout sem simular pagamento real, prova social e FAQ. Foco máximo em conversão e confiança.",
    expectedKind: "site",
    expectedProfile: "conversion-commerce",
    requiredCapabilities: [
      "dados reais via window.AD, com vazio/carregando/erro",
      "jornada comercial clara, sem simular pagamento real",
    ],
    expectedVideoMode: "none",
  },
  {
    id: "media",
    name: "Experiência com mídia",
    prompt: "Crie um site institucional premium para uma empresa de arquitetura usando a imagem enviada como referência e inclua uma área de vídeo responsiva com controles. Se não houver vídeo enviado, mostre o placeholder correto para mídia sem inventar URL.",
    expectedKind: "site",
    expectedProfile: "editorial-luxury",
    requiredCapabilities: ["mídia em vídeo responsiva, com controles e fallback"],
    mediaAssets: [
      {
        name: "fachada-referencia.webp",
        type: "image/webp",
        url: "https://example.invalid/fachada-referencia.webp",
      },
    ],
    expectedVideoMode: "placeholder",
  },
];
