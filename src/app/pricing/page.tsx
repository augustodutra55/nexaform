import Link from "next/link";
import { Check } from "lucide-react";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { SiteHeader, SiteFooter } from "@/components/marketing/site-shell";
import { PLANS } from "@/lib/plans";

export const metadata: Metadata = { title: "Preços" };

const comparison: [string, string, string, string][] = [
  ["Projetos", "3", "Ilimitados", "Ilimitados"],
  ["Gerações por mês", "30", "500", "3.000 (time)"],
  ["Preview em tempo real", "✓", "✓", "✓"],
  ["Publicação com link", "✓", "✓", "✓"],
  ["Histórico de versões", "5 por projeto", "Ilimitado", "Ilimitado"],
  ["Exportação (JSON + código)", "—", "✓", "✓"],
  ["Provedores de IA premium", "—", "✓", "✓"],
  ["Colaboração em tempo real", "—", "—", "✓"],
  ["Papéis e permissões", "—", "—", "✓"],
];

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1 py-20">
        <div className="container">
          <div className="text-center">
            <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
              Comece grátis. <span className="text-brand">Escale quando fizer sentido.</span>
            </h1>
            <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
              Sem taxa de setup, sem fidelidade. Faça upgrade ou downgrade a qualquer momento.
            </p>
          </div>

          <div className="mt-16 grid gap-6 lg:grid-cols-3">
            {Object.values(PLANS).map((plan) => (
              <Card key={plan.id} className={`flex flex-col ${plan.highlighted ? "border-primary shadow-xl glow-brand lg:-translate-y-2" : ""}`}>
                <CardContent className="flex-1 pt-6">
                  {plan.highlighted && <Badge className="mb-3">Mais popular</Badge>}
                  <h2 className="text-lg font-semibold">{plan.name}</h2>
                  <p className="mt-3">
                    <span className="text-4xl font-bold">{plan.price}</span>{" "}
                    <span className="text-sm text-muted-foreground">{plan.priceNote}</span>
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">{plan.tagline}</p>
                  <ul className="mt-6 space-y-2.5 text-sm">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {f}
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button className="w-full" variant={plan.highlighted ? "brand" : "outline"} asChild>
                    <Link href="/cadastro">{plan.id === "free" ? "Começar grátis" : `Assinar ${plan.name}`}</Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>

          {/* Tabela comparativa */}
          <div className="mx-auto mt-20 max-w-4xl overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-secondary/50 text-left">
                  <th className="p-4 font-medium">Recurso</th>
                  <th className="p-4 font-medium">Free</th>
                  <th className="p-4 font-medium text-primary">Pro</th>
                  <th className="p-4 font-medium">Team</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map(([feature, free, pro, team]) => (
                  <tr key={feature} className="border-b last:border-0">
                    <td className="p-4 text-muted-foreground">{feature}</td>
                    <td className="p-4">{free}</td>
                    <td className="p-4">{pro}</td>
                    <td className="p-4">{team}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-8 text-center text-sm text-muted-foreground">
            Dúvidas sobre planos? <Link href="/#faq" className="text-primary underline-offset-4 hover:underline">Veja o FAQ</Link> ou fale com a gente.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
