import Link from "next/link";
import {
  MessageSquareText,
  Eye,
  Rocket,
  Layers,
  History,
  Share2,
  Palette,
  Zap,
  ShieldCheck,
  Check,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SiteHeader, SiteFooter } from "@/components/marketing/site-shell";
import { PLANS } from "@/lib/plans";

const steps = [
  {
    icon: MessageSquareText,
    title: "Descreva",
    text: "Uma frase basta. Diga o que o produto faz, para quem é e como deve parecer — em português, do seu jeito.",
  },
  {
    icon: Eye,
    title: "Assista à construção",
    text: "O AD Studio interpreta a intenção, estrutura páginas e componentes e renderiza o preview na hora, em desktop e mobile.",
  },
  {
    icon: Rocket,
    title: "Refine e publique",
    text: "Cada mensagem é uma iteração cirúrgica: só muda o que você pediu. Versione, publique e compartilhe com um link.",
  },
];

const benefits = [
  {
    icon: Zap,
    title: "Velocidade que muda o jogo",
    text: "Da ideia ao primeiro preview em menos de um minuto. Nada de boilerplate, setup ou tela em branco.",
  },
  {
    icon: Layers,
    title: "Geração incremental de verdade",
    text: "Seu produto é um schema vivo. Refinamentos mutam apenas o necessário — rápido, previsível e reversível.",
  },
  {
    icon: History,
    title: "Cada marco, uma versão",
    text: "Histórico completo e restaurável. Experimente sem medo: o passado está sempre a um clique.",
  },
  {
    icon: Palette,
    title: "Design sob comando",
    text: "Cor, tipografia, raio e modo claro/escuro respondem tanto ao chat quanto ao editor visual.",
  },
  {
    icon: Share2,
    title: "Do rascunho ao ar",
    text: "Publique com um link compartilhável ou exporte o projeto inteiro. Sem lock-in, sem fricção.",
  },
  {
    icon: ShieldCheck,
    title: "Privado por padrão",
    text: "Autenticação robusta, projetos isolados por usuário e dados sempre exportáveis.",
  },
];

const examples = [
  { tag: "SaaS", title: "Plataforma de agendamento para clínicas", desc: "Landing + preços + onboarding" },
  { tag: "Dashboard", title: "Painel de vendas com KPIs e gráficos", desc: "Métricas, tabelas e relatórios" },
  { tag: "E-commerce", title: "Loja de café especial", desc: "Vitrine, catálogo e página de contato" },
  { tag: "Portfólio", title: "Portfólio de fotografia", desc: "Galeria, sobre e formulário" },
  { tag: "Landing", title: "Lançamento de curso online", desc: "Hero, depoimentos, FAQ e CTA" },
  { tag: "Interno", title: "Painel administrativo de assinaturas", desc: "Tabelas, filtros e indicadores" },
];

const faqs = [
  {
    q: "Preciso saber programar para usar o AD Studio?",
    a: "Não. Você descreve o que quer em linguagem natural e o AD Studio cuida da estrutura, do visual e do conteúdo. Se você programa, exporte o projeto e continue no seu editor.",
  },
  {
    q: "Como funciona a geração por baixo dos panos?",
    a: "Cada pedido vira um schema estruturado — uma árvore de páginas, seções e componentes. O preview é renderizado a partir desse schema e refinamentos alteram apenas as partes necessárias. É o que torna o AD Studio rápido e previsível.",
  },
  {
    q: "Posso usar minha própria chave de IA?",
    a: "Sim. Nas configurações você conecta sua chave da Anthropic ou OpenRouter — ela fica apenas no seu navegador. Sem chave, o motor local do AD Studio gera tudo em modo demo, sem custo.",
  },
  {
    q: "O que acontece quando atinjo o limite do plano Free?",
    a: "Seus projetos continuam intactos e acessíveis. Para seguir gerando, aguarde a virada do mês ou faça upgrade para o Pro.",
  },
  {
    q: "Consigo exportar o que eu criar?",
    a: "No plano Pro você exporta o schema completo do projeto em JSON, pronto para renderizar fora do AD Studio — além do link publicado, disponível em todos os planos.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="surface-grid absolute inset-0 opacity-40 [mask-image:radial-gradient(60%_50%_at_50%_35%,black,transparent)]" />
          <div className="pointer-events-none absolute left-1/2 top-[-8rem] h-[24rem] w-[42rem] -translate-x-1/2 rounded-full bg-brand-500/15 blur-[120px]" />
          <div className="container relative flex flex-col items-center py-24 text-center md:py-32">
            <Badge className="mb-6 animate-fade-up border border-brand-500/20">
              O estúdio digital de criação de produtos
            </Badge>
            <h1 className="max-w-3xl animate-fade-up font-display text-4xl font-bold tracking-tight md:text-[4.25rem] md:leading-[1.05]">
              Onde ideias
              <br />
              <span className="text-brand">viram produtos.</span>
            </h1>
            <p className="mt-6 max-w-xl animate-fade-up text-lg text-muted-foreground">
              O AD Studio transforma linguagem natural em apps, sites e dashboards completos —
              com preview instantâneo, refinamento por chat e controle total de versões.
              Criar, aprender e construir, num só lugar.
            </p>
            <div className="mt-8 flex animate-fade-up flex-col gap-3 sm:flex-row">
              <Button size="lg" variant="brand" asChild>
                <Link href="/cadastro">
                  Começar a construir <ArrowRight />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/#como-funciona">Ver como funciona</Link>
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Sem cartão de crédito · Primeiro preview em menos de 60 segundos
            </p>

            {/* Mock do produto */}
            <div className="shadow-elevated mt-16 w-full max-w-4xl animate-fade-up rounded-xl border bg-card p-2">
              <div className="flex items-center gap-1.5 border-b px-3 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-border" />
                <span className="h-2.5 w-2.5 rounded-full bg-border" />
                <span className="h-2.5 w-2.5 rounded-full bg-border" />
                <span className="ml-3 text-xs text-muted-foreground">ad studio · atlas-agendamentos</span>
              </div>
              <div className="grid gap-2 p-2 md:grid-cols-[1fr_1.6fr]">
                <div className="space-y-2 rounded-lg bg-secondary/50 p-3 text-left">
                  <div className="ml-auto w-fit max-w-[85%] rounded-lg bg-brand-500 px-3 py-2 text-xs text-white">
                    Crie a plataforma de agendamento Atlas, com planos e FAQ
                  </div>
                  <div className="w-fit max-w-[85%] rounded-lg bg-background px-3 py-2 text-xs text-muted-foreground">
                    Estruturei 3 páginas: Início, Preços e Contato. Quer ajustar o tom visual?
                  </div>
                  <div className="ml-auto w-fit max-w-[85%] rounded-lg bg-brand-500 px-3 py-2 text-xs text-white">
                    Tema escuro, tom violeta, e adicione depoimentos
                  </div>
                </div>
                <div className="space-y-2 rounded-lg border bg-background p-4 text-left">
                  <div className="h-3 w-2/3 rounded bg-brand-500/80" />
                  <div className="h-2 w-1/2 rounded bg-muted" />
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="space-y-1.5 rounded-md border p-2">
                        <div className="h-6 w-6 rounded bg-brand-500/25" />
                        <div className="h-2 w-full rounded bg-muted" />
                        <div className="h-2 w-2/3 rounded bg-muted" />
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 h-8 w-28 rounded-md bg-brand-500/80" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Como funciona */}
        <section id="como-funciona" className="border-t border-border/60 py-24">
          <div className="container">
            <p className="text-center text-sm font-medium uppercase tracking-widest text-brand-400">Como funciona</p>
            <h2 className="mt-3 text-center font-display text-3xl font-bold tracking-tight md:text-4xl">
              Três movimentos. Nenhuma linha de código.
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-center text-muted-foreground">
              O fluxo inteiro cabe numa frase: descreva, assista, refine.
            </p>
            <div className="mt-14 grid gap-6 md:grid-cols-3">
              {steps.map((s, i) => (
                <Card key={s.title} className="transition-transform hover:-translate-y-1">
                  <CardContent className="pt-6">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/12 text-brand-400 ring-1 ring-brand-500/25">
                        <s.icon className="h-5 w-5" />
                      </div>
                      <span className="text-xs font-medium text-muted-foreground">0{i + 1}</span>
                    </div>
                    <h3 className="mb-2 font-semibold">{s.title}</h3>
                    <p className="text-sm text-muted-foreground">{s.text}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Benefícios — corte editorial */}
        <section id="recursos" className="border-t border-border/60 bg-secondary/30 py-24">
          <div className="container">
            <div className="grid gap-10 lg:grid-cols-[1fr_1.8fr]">
              <div>
                <p className="text-sm font-medium uppercase tracking-widest text-brand-400">Por que AD Studio</p>
                <h2 className="mt-3 font-display text-3xl font-bold tracking-tight md:text-4xl">
                  Um estúdio para quem leva produto a sério
                </h2>
                <p className="mt-4 text-muted-foreground">
                  Não é um gerador de mockups. É uma plataforma de construção: schema estruturado,
                  versões restauráveis e um preview que é o próprio produto.
                </p>
              </div>
              <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
                {benefits.map((b) => (
                  <div key={b.title} className="bg-card p-6 transition-colors hover:bg-secondary/40">
                    <b.icon className="mb-3 h-5 w-5 text-brand-400" />
                    <h3 className="mb-1.5 font-semibold">{b.title}</h3>
                    <p className="text-sm text-muted-foreground">{b.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Exemplos */}
        <section id="exemplos" className="border-t border-border/60 py-24">
          <div className="container">
            <p className="text-center text-sm font-medium uppercase tracking-widest text-brand-400">Exemplos</p>
            <h2 className="mt-3 text-center font-display text-3xl font-bold tracking-tight md:text-4xl">
              O que nasce no AD Studio
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-center text-muted-foreground">
              Cada um destes começou com uma única mensagem no chat.
            </p>
            <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {examples.map((e) => (
                <div
                  key={e.title}
                  className="group rounded-xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-brand-500/50"
                >
                  <Badge variant="secondary" className="mb-3">{e.tag}</Badge>
                  <h3 className="font-medium group-hover:text-brand-400">{e.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{e.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing resumido */}
        <section className="border-t border-border/60 bg-secondary/30 py-24">
          <div className="container">
            <h2 className="text-center font-display text-3xl font-bold tracking-tight md:text-4xl">
              Preço direto. Ambição ilimitada.
            </h2>
            <div className="mt-14 grid gap-6 md:grid-cols-3">
              {Object.values(PLANS).map((plan) => (
                <Card key={plan.id} className={plan.highlighted ? "border-brand-500/60 shadow-lg glow-brand" : ""}>
                  <CardContent className="pt-6">
                    {plan.highlighted && <Badge className="mb-3">Mais popular</Badge>}
                    <h3 className="font-semibold">{plan.name}</h3>
                    <p className="mt-2">
                      <span className="text-3xl font-bold">{plan.price}</span>{" "}
                      <span className="text-sm text-muted-foreground">{plan.priceNote}</span>
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">{plan.tagline}</p>
                    <ul className="mt-4 space-y-2 text-sm">
                      {plan.features.slice(0, 3).map((f) => (
                        <li key={f} className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" /> {f}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="mt-8 text-center">
              <Button variant="outline" asChild>
                <Link href="/pricing">Comparar planos em detalhe</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="border-t border-border/60 py-24">
          <div className="container max-w-3xl">
            <h2 className="text-center font-display text-3xl font-bold tracking-tight md:text-4xl">
              Perguntas frequentes
            </h2>
            <div className="mt-12 space-y-3">
              {faqs.map((f) => (
                <details key={f.q} className="group rounded-xl border bg-card p-5 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer items-center justify-between font-medium">
                    {f.q}
                    <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA final */}
        <section className="border-t border-border/60 py-24">
          <div className="container text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
              Seu próximo produto já tem <span className="text-brand">onde nascer</span>
            </h2>
            <p className="mx-auto mt-4 max-w-md text-muted-foreground">
              Crie sua conta e coloque a primeira versão de pé antes do café esfriar.
            </p>
            <Button size="lg" variant="brand" className="mt-8" asChild>
              <Link href="/cadastro">
                Criar conta grátis <ArrowRight />
              </Link>
            </Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
