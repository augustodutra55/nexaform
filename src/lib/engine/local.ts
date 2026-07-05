/**
 * Motor local de geração — determinístico, sem custo de API.
 * Interpreta o pedido por heurísticas, monta um AppSchema a partir de
 * templates de seção e aplica refinamentos incrementais em pedidos seguintes.
 */
import { nanoid } from "nanoid";
import {
  AppSchema,
  DEFAULT_THEME,
  GenerationResult,
  PageNode,
  Section,
  SectionType,
} from "./types";

type Kind = "landing" | "dashboard" | "ecommerce" | "blog" | "portfolio" | "saas";

const sid = () => nanoid(8);

/* ── Interpretação ──────────────────────────────────────────── */

const KIND_HINTS: [Kind, RegExp][] = [
  ["dashboard", /dashboard|painel|m[ée]tricas|analytics|admin|kpi|relat[óo]rio/i],
  ["ecommerce", /loja|e-?commerce|produto|venda|carrinho|cat[áa]logo/i],
  ["blog", /blog|not[íi]cia|artigo|revista|conte[úu]do editorial/i],
  ["portfolio", /portf[óo]lio|portfolio|trabalhos|fot[óo]grafo|designer pessoal/i],
  ["saas", /saas|assinatura|plataforma|ferramenta|startup|app de/i],
];

const COLOR_HINTS: [string, RegExp][] = [
  ["#3b82f6", /azul/i],
  ["#10b981", /verde/i],
  ["#8b5cf6", /rox[oa]|violeta|lil[áa]s/i],
  ["#ec4899", /rosa|pink/i],
  ["#ef4444", /vermelh[oa]/i],
  ["#f59e0b", /amarel[oa]|dourad[oa]/i],
  ["#fd7c11", /laranja/i],
  ["#06b6d4", /ciano|turquesa/i],
  ["#14b8a6", /teal|esmeralda/i],
];

const STOPWORDS =
  /\b(crie|criar|cria|quero|faça|faca|fazer|monte|montar|gere|gerar|preciso|de|do|da|dos|das|um|uma|para|pra|com|o|a|os|as|e|que|meu|minha|site|app|aplicativo|landing|page|p[áa]gina|dashboard|painel|plataforma|sistema|web|novo|nova)\b/gi;

function detectKind(prompt: string): Kind {
  for (const [kind, re] of KIND_HINTS) if (re.test(prompt)) return kind;
  return "landing";
}

function extractTopic(prompt: string): string {
  const cleaned = prompt.replace(STOPWORDS, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Meu Produto";
  const words = cleaned.split(" ").slice(0, 4);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function detectColor(prompt: string): string | null {
  for (const [hex, re] of COLOR_HINTS) if (re.test(prompt)) return hex;
  const hexMatch = prompt.match(/#([0-9a-f]{6})\b/i);
  return hexMatch ? `#${hexMatch[1]}` : null;
}

/* ── Templates de seção ─────────────────────────────────────── */

function navbar(brand: string, pages: { name: string; path: string }[]): Section {
  return {
    id: sid(),
    type: "navbar",
    props: { brand, links: pages, cta: "Começar agora" },
  };
}

function hero(topic: string, kind: Kind): Section {
  const copy: Record<Kind, { title: string; subtitle: string }> = {
    landing: {
      title: `${topic}: tudo o que você precisa em um só lugar`,
      subtitle: `Conheça ${topic} — simples de usar, rápido de amar. Comece em minutos, sem cartão de crédito.`,
    },
    saas: {
      title: `${topic} para times que não podem perder tempo`,
      subtitle: `Automatize o trabalho repetitivo e foque no que importa. ${topic} cuida do resto.`,
    },
    ecommerce: {
      title: `${topic} — qualidade que chega até você`,
      subtitle: `Produtos selecionados, entrega rápida e atendimento que resolve. Frete grátis na primeira compra.`,
    },
    blog: {
      title: `${topic}: ideias que valem a leitura`,
      subtitle: `Artigos, análises e histórias publicadas toda semana. Assine e receba direto no seu email.`,
    },
    portfolio: {
      title: `Olá, eu crio ${topic.toLowerCase()}`,
      subtitle: `Uma seleção dos meus melhores trabalhos. Vamos construir algo juntos?`,
    },
    dashboard: {
      title: `Visão geral — ${topic}`,
      subtitle: `Acompanhe seus indicadores em tempo real.`,
    },
  };
  return {
    id: sid(),
    type: "hero",
    props: { badge: "Novo", ...copy[kind], cta: "Começar grátis", secondaryCta: "Ver demonstração" },
  };
}

function features(topic: string): Section {
  return {
    id: sid(),
    type: "features",
    props: {
      title: "Por que escolher a gente",
      items: [
        { icon: "zap", title: "Rápido de verdade", description: "Performance pensada desde o primeiro clique, sem esperas desnecessárias." },
        { icon: "shield", title: "Seguro por padrão", description: "Seus dados protegidos com criptografia e boas práticas de ponta a ponta." },
        { icon: "sparkles", title: "Simples e bonito", description: `${topic} foi desenhado para ser intuitivo — ninguém precisa de manual.` },
        { icon: "layers", title: "Cresce com você", description: "Comece pequeno e escale sem trocar de ferramenta no meio do caminho." },
        { icon: "clock", title: "Economize horas", description: "Automatize o repetitivo e recupere tempo para o que realmente importa." },
        { icon: "heart", title: "Suporte humano", description: "Gente de verdade respondendo rápido quando você precisar." },
      ],
    },
  };
}

function stats(): Section {
  return {
    id: sid(),
    type: "stats",
    props: {
      items: [
        { value: "12k+", label: "usuários ativos" },
        { value: "99,9%", label: "de disponibilidade" },
        { value: "4.8/5", label: "avaliação média" },
        { value: "30s", label: "para começar" },
      ],
    },
  };
}

function testimonials(topic: string): Section {
  return {
    id: sid(),
    type: "testimonials",
    props: {
      title: "Quem usa, recomenda",
      items: [
        { quote: `${topic} mudou completamente a forma como trabalhamos. Não consigo imaginar voltar atrás.`, name: "Mariana Costa", role: "Fundadora, Loop Studio" },
        { quote: "Implementamos em uma tarde e o time inteiro adotou sem resistência. Raro de acontecer.", name: "Rafael Lima", role: "Head de Produto, Vetor" },
        { quote: "O suporte responde em minutos e o produto melhora toda semana. Vale cada centavo.", name: "Júlia Andrade", role: "COO, Maré Digital" },
      ],
    },
  };
}

function pricing(): Section {
  return {
    id: sid(),
    type: "pricing",
    props: {
      title: "Planos para cada momento",
      subtitle: "Comece grátis e evolua quando fizer sentido.",
      plans: [
        { name: "Grátis", price: "R$ 0", note: "para sempre", features: ["Recursos essenciais", "1 usuário", "Suporte por email"], highlighted: false },
        { name: "Pro", price: "R$ 49", note: "/mês", features: ["Tudo do Grátis", "Recursos avançados", "Usuários ilimitados", "Suporte prioritário"], highlighted: true },
        { name: "Empresa", price: "Sob consulta", note: "", features: ["Tudo do Pro", "SLA dedicado", "Onboarding assistido"], highlighted: false },
      ],
    },
  };
}

function faq(topic: string): Section {
  return {
    id: sid(),
    type: "faq",
    props: {
      title: "Perguntas frequentes",
      items: [
        { q: "Preciso de cartão de crédito para começar?", a: "Não. O plano gratuito não pede cartão e você pode usar pelo tempo que quiser." },
        { q: `Consigo migrar meus dados para ${topic}?`, a: "Sim — oferecemos importação assistida e o suporte acompanha todo o processo." },
        { q: "Posso cancelar quando quiser?", a: "Pode. Sem multa, sem letra miúda. Seus dados ficam disponíveis para exportação por 30 dias." },
        { q: "Vocês têm desconto para estudantes ou ONGs?", a: "Temos! Fale com o nosso time e apresentamos as condições especiais." },
      ],
    },
  };
}

function cta(topic: string): Section {
  return {
    id: sid(),
    type: "cta",
    props: {
      title: `Pronto para conhecer ${topic}?`,
      subtitle: "Leva menos de um minuto para criar sua conta.",
      cta: "Criar conta grátis",
    },
  };
}

function footer(brand: string): Section {
  return {
    id: sid(),
    type: "footer",
    props: {
      brand,
      tagline: "Feito com cuidado, do começo ao fim.",
      columns: [
        { title: "Produto", links: ["Recursos", "Preços", "Novidades", "Roadmap"] },
        { title: "Empresa", links: ["Sobre", "Blog", "Carreiras", "Contato"] },
        { title: "Legal", links: ["Privacidade", "Termos", "Cookies"] },
      ],
    },
  };
}

function gallery(topic: string): Section {
  return {
    id: sid(),
    type: "gallery",
    props: {
      title: `Destaques de ${topic}`,
      items: [
        { title: "Projeto Aurora", tag: "Branding" },
        { title: "Estudo Maré", tag: "UI Design" },
        { title: "Série Horizonte", tag: "Fotografia" },
        { title: "Campanha Norte", tag: "Direção de arte" },
        { title: "Ensaios Urbanos", tag: "Fotografia" },
        { title: "Identidade Vetor", tag: "Branding" },
      ],
    },
  };
}

function contactForm(): Section {
  return {
    id: sid(),
    type: "form",
    props: {
      title: "Fale com a gente",
      subtitle: "Respondemos em até um dia útil.",
      fields: [
        { label: "Nome", type: "text", placeholder: "Seu nome" },
        { label: "Email", type: "email", placeholder: "voce@email.com" },
        { label: "Mensagem", type: "textarea", placeholder: "Como podemos ajudar?" },
      ],
      submit: "Enviar mensagem",
    },
  };
}

function kpis(): Section {
  return {
    id: sid(),
    type: "kpis",
    props: {
      items: [
        { label: "Receita do mês", value: "R$ 48.290", delta: "+12,4%", up: true },
        { label: "Novos clientes", value: "312", delta: "+8,1%", up: true },
        { label: "Churn", value: "2,3%", delta: "-0,4pp", up: true },
        { label: "Ticket médio", value: "R$ 154", delta: "-1,2%", up: false },
      ],
    },
  };
}

function chart(): Section {
  return {
    id: sid(),
    type: "chart",
    props: {
      title: "Receita por mês",
      type: "bars",
      labels: ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago"],
      points: [24, 31, 28, 39, 44, 41, 52, 58],
    },
  };
}

function dataTable(): Section {
  return {
    id: sid(),
    type: "table",
    props: {
      title: "Últimas transações",
      columns: ["Cliente", "Plano", "Valor", "Status"],
      rows: [
        ["Estúdio Maré", "Pro", "R$ 490", "Pago"],
        ["Vetor Labs", "Team", "R$ 1.240", "Pago"],
        ["Loop Studio", "Pro", "R$ 490", "Pendente"],
        ["Aurora Design", "Free → Pro", "R$ 490", "Pago"],
        ["Norte Filmes", "Team", "R$ 1.240", "Falhou"],
      ],
    },
  };
}

/* ── Montagem por tipo de projeto ───────────────────────────── */

function buildPages(kind: Kind, topic: string): PageNode[] {
  const brand = topic.split(" ")[0];

  if (kind === "dashboard") {
    return [
      {
        id: sid(),
        name: "Visão geral",
        path: "/",
        sections: [navbar(brand, [{ name: "Visão geral", path: "/" }, { name: "Relatórios", path: "/relatorios" }]), kpis(), chart(), dataTable()],
      },
      {
        id: sid(),
        name: "Relatórios",
        path: "/relatorios",
        sections: [navbar(brand, [{ name: "Visão geral", path: "/" }, { name: "Relatórios", path: "/relatorios" }]), chart(), dataTable()],
      },
    ];
  }

  const navLinks = [
    { name: "Início", path: "/" },
    { name: "Preços", path: "/precos" },
    { name: "Contato", path: "/contato" },
  ];

  const home: Section[] = [navbar(brand, navLinks), hero(topic, kind)];
  if (kind === "portfolio") home.push(gallery(topic));
  home.push(features(topic), stats());
  if (kind !== "portfolio") home.push(testimonials(topic));
  if (kind === "ecommerce") home.push(gallery(topic));
  home.push(cta(topic), footer(brand));

  return [
    { id: sid(), name: "Início", path: "/", sections: home },
    {
      id: sid(),
      name: "Preços",
      path: "/precos",
      sections: [navbar(brand, navLinks), pricing(), faq(topic), footer(brand)],
    },
    {
      id: sid(),
      name: "Contato",
      path: "/contato",
      sections: [navbar(brand, navLinks), contactForm(), footer(brand)],
    },
  ];
}

/* ── Refinamento incremental ────────────────────────────────── */

const ADDABLE: [SectionType, RegExp, (topic: string) => Section][] = [
  ["faq", /faq|perguntas/i, faq],
  ["pricing", /pre[çc]os?|planos?|pricing/i, () => pricing()],
  ["testimonials", /depoimentos?|testemunhos?|avalia[çc][õo]es/i, testimonials],
  ["form", /formul[áa]rio|contato/i, () => contactForm()],
  ["gallery", /galeria|portf[óo]lio|imagens|fotos/i, gallery],
  ["stats", /estat[íi]sticas|n[úu]meros|m[ée]tricas/i, () => stats()],
  ["cta", /cta|chamada/i, cta],
  ["chart", /gr[áa]fico/i, () => chart()],
  ["table", /tabela/i, () => dataTable()],
  ["kpis", /kpis?|indicadores/i, () => kpis()],
];

function refine(prompt: string, schema: AppSchema): { schema: AppSchema; changes: string[] } {
  const next: AppSchema = JSON.parse(JSON.stringify(schema));
  const changes: string[] = [];
  const topic = next.name;
  const page = next.pages[0];

  const color = detectColor(prompt);
  if (color && /cor|tema|paleta|azul|verde|rox|rosa|vermelh|amarel|laranja|ciano|teal/i.test(prompt)) {
    next.theme.primary = color;
    changes.push("Atualizei a cor primária do tema");
  }
  if (/modo claro|tema claro|light/i.test(prompt)) {
    next.theme.mode = "light";
    changes.push("Mudei o tema para modo claro");
  }
  if (/modo escuro|tema escuro|dark/i.test(prompt)) {
    next.theme.mode = "dark";
    changes.push("Mudei o tema para modo escuro");
  }
  if (/borda|cantos? (mais )?arredondad|quadrad/i.test(prompt)) {
    next.theme.radius = /quadrad|reto/i.test(prompt) ? 4 : 16;
    changes.push("Ajustei o raio das bordas");
  }

  const isRemove = /remov[ae]|tir[ae]|exclu[ai]|delet[ae]/i.test(prompt);
  const isAdd = /adicion[ae]|inclu[ai]|coloc[ae]|acrescent[ae]|cri[ae]/i.test(prompt);

  for (const [type, re, build] of ADDABLE) {
    if (!re.test(prompt)) continue;
    if (isRemove) {
      for (const p of next.pages) p.sections = p.sections.filter((s) => s.type !== type);
      changes.push(`Removi a seção de ${type}`);
    } else if (isAdd) {
      const target = /p[áa]gina de|na p[áa]gina/i.test(prompt)
        ? next.pages.find((p) => prompt.toLowerCase().includes(p.name.toLowerCase())) ?? page
        : page;
      const insertAt = Math.max(target.sections.length - 1, 1); // antes do footer
      target.sections.splice(insertAt, 0, build(topic));
      changes.push(`Adicionei uma seção de ${type} em "${target.name}"`);
    }
  }

  const newPage = prompt.match(/(?:nova p[áa]gina|p[áa]gina)\s+(?:de\s+|chamada\s+)?["“]?([\wÀ-ſ ]{2,24})["”]?/i);
  if (isAdd && newPage && !ADDABLE.some(([, re]) => re.test(newPage[1]))) {
    const name = newPage[1].trim();
    const path = "/" + name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-");
    if (!next.pages.some((p) => p.path === path)) {
      next.pages.push({
        id: sid(),
        name: name.charAt(0).toUpperCase() + name.slice(1),
        path,
        sections: [
          navbar(next.name.split(" ")[0], next.pages.map((p) => ({ name: p.name, path: p.path }))),
          { id: sid(), type: "content", props: { title: name, body: `Conteúdo da página ${name}. Peça no chat para eu preencher esta seção.` } },
          footer(next.name.split(" ")[0]),
        ],
      });
      changes.push(`Criei a página "${name}"`);
    }
  }

  const newTitle = prompt.match(/(?:t[íi]tulo|headline)\s+(?:para|pra)?\s*["“](.+?)["”]/i);
  if (newTitle) {
    for (const p of next.pages) {
      const h = p.sections.find((s) => s.type === "hero");
      if (h) {
        h.props.title = newTitle[1];
        changes.push("Atualizei a headline do hero");
        break;
      }
    }
  }

  if (changes.length === 0) {
    // fallback: dá um retoque geral no copy do hero com o texto do usuário
    changes.push("Registrei seu pedido — descreva a mudança citando a seção (ex.: 'adicione uma seção de FAQ' ou 'mude a cor para azul')");
  }

  return { schema: next, changes };
}

/* ── API pública do motor local ─────────────────────────────── */

export function generateLocal(prompt: string, existing?: AppSchema | null): GenerationResult {
  if (existing && existing.pages.length > 0) {
    const { schema, changes } = refine(prompt, existing);
    return {
      provider: "local",
      schema,
      plan: changes,
      reply:
        changes.length > 1 || !changes[0].startsWith("Registrei")
          ? `Prontinho! ${changes.join(". ")}. Dá uma olhada no preview e me diga o que refinar em seguida.`
          : `Hmm, não identifiquei uma instrução clara. ${changes[0]}.`,
    };
  }

  const kind = detectKind(prompt);
  const topic = extractTopic(prompt);
  const color = detectColor(prompt);

  const schema: AppSchema = {
    name: topic,
    description: prompt.slice(0, 240),
    theme: { ...DEFAULT_THEME, ...(color ? { primary: color } : {}) },
    pages: buildPages(kind, topic),
  };

  const kindLabel: Record<Kind, string> = {
    landing: "landing page",
    dashboard: "dashboard",
    ecommerce: "loja",
    blog: "blog",
    portfolio: "portfólio",
    saas: "produto SaaS",
  };

  const plan = [
    `Interpretar o pedido como ${kindLabel[kind]} sobre "${topic}"`,
    `Estruturar ${schema.pages.length} página${schema.pages.length > 1 ? "s" : ""}: ${schema.pages.map((p) => p.name).join(", ")}`,
    "Montar seções e componentes de cada página",
    "Aplicar tema e identidade visual",
    "Renderizar preview em tempo real",
  ];

  return {
    provider: "local",
    schema,
    plan,
    reply: `Criei a primeira versão de "${topic}" como ${kindLabel[kind]} com ${schema.pages.length} páginas. Explore o preview ao lado e me peça refinamentos — por exemplo: "mude a cor para azul", "adicione uma seção de FAQ" ou "crie uma página Sobre".`,
  };
}
