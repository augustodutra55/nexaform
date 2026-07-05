"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, KeyRound, Cpu, User, CreditCard } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { resolvePlan, isOwner, formatLimit, type AccessProfile } from "@/lib/access";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const PROVIDERS = [
  { id: "local", name: "Motor local", desc: "Grátis e offline. Geração por templates — ótimo para começar." },
  { id: "claude", name: "Claude (Anthropic)", desc: "Melhor qualidade. Use sua própria API key." },
  { id: "openrouter", name: "OpenRouter", desc: "Acesso a vários modelos com uma única chave." },
];

export default function SettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState("local");
  const [apiKey, setApiKey] = useState("");
  const [access, setAccess] = useState<AccessProfile>({});
  const [usage, setUsage] = useState<{ generations: number; projects: number } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setEmail(data.user.email ?? "");
        setName((data.user.user_metadata?.full_name as string) ?? "");
      }
      setProvider(localStorage.getItem("nexaform:ai-provider") || "local");
      setApiKey(localStorage.getItem("nexaform:ai-key") || "");

      const [{ data: sub }, { data: prof }] = await Promise.all([
        supabase.from("subscriptions").select("plan").maybeSingle(),
        supabase.from("profiles").select("role").maybeSingle(),
      ]);
      setAccess({ plan: sub?.plan, role: prof?.role, email: data.user?.email });

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const [{ count: gen }, { count: proj }] = await Promise.all([
        supabase
          .from("generations")
          .select("id", { count: "exact", head: true })
          .gte("created_at", monthStart.toISOString()),
        supabase.from("projects").select("id", { count: "exact", head: true }),
      ]);
      setUsage({ generations: gen ?? 0, projects: proj ?? 0 });
    })();
  }, [supabase]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ data: { full_name: name } });
    setBusy(false);
    error ? toast.error("Não foi possível salvar") : toast.success("Perfil atualizado");
  }

  function saveProvider() {
    localStorage.setItem("nexaform:ai-provider", provider);
    if (provider === "local") {
      localStorage.removeItem("nexaform:ai-key");
    } else {
      localStorage.setItem("nexaform:ai-key", apiKey);
    }
    toast.success("Preferências de IA salvas", {
      description: provider === "local" ? "Usando o motor local (grátis)." : "Sua chave fica apenas no seu navegador.",
    });
  }

  const owner = isOwner(access);
  const plan = resolvePlan(access);

  return (
    <div className="container max-w-3xl space-y-6 py-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">Conta, provedor de IA e plano.</p>
      </div>

      {/* Perfil */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><User className="h-4 w-4" /> Perfil</CardTitle>
          <CardDescription>Como você aparece no Nexaform.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={email} disabled />
            </div>
            <div className="flex items-center justify-between">
              <Link href="/recuperar-senha" className="text-sm text-primary underline-offset-4 hover:underline">
                <KeyRound className="mr-1 inline h-3.5 w-3.5" />
                Redefinir senha
              </Link>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />} Salvar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Provedor de IA */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Cpu className="h-4 w-4" /> Motor de IA</CardTitle>
          <CardDescription>
            O Nexaform funciona sem chave nenhuma (motor local). Conecte a sua para gerações mais inteligentes — a
            chave fica somente no seu navegador e é enviada direto ao provedor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => setProvider(p.id)}
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors hover:border-primary/60",
                  provider === p.id && "border-primary ring-1 ring-primary"
                )}
              >
                <p className="text-sm font-medium">{p.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{p.desc}</p>
              </button>
            ))}
          </div>
          {provider !== "local" && (
            <div className="space-y-2">
              <Label htmlFor="apikey">API key {provider === "claude" ? "da Anthropic" : "do OpenRouter"}</Label>
              <Input
                id="apikey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider === "claude" ? "sk-ant-…" : "sk-or-…"}
              />
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={saveProvider}>Salvar preferências</Button>
          </div>
        </CardContent>
      </Card>

      {/* Plano e uso */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CreditCard className="h-4 w-4" /> Plano e uso</CardTitle>
          <CardDescription>Seu consumo neste mês.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="flex items-center gap-2 font-medium">
                {owner ? (
                  <>
                    Conta Owner{" "}
                    <Badge className="border border-brand-500/30">Acesso total · Pro + Team liberados</Badge>
                  </>
                ) : (
                  <>
                    Plano {plan.name} <Badge>{plan.price}{plan.priceNote && ` ${plan.priceNote}`}</Badge>
                  </>
                )}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
            </div>
            {!owner && plan.id !== "team" && (
              <Button variant="brand" asChild>
                <Link href="/pricing">Fazer upgrade</Link>
              </Button>
            )}
          </div>

          {usage && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Gerações este mês</p>
                <p className="mt-1 text-2xl font-bold">
                  {usage.generations}
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}/ {formatLimit(plan.maxGenerationsPerMonth)}
                  </span>
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full bg-brand-gradient transition-all"
                    style={{
                      width: owner
                        ? "100%"
                        : `${Math.min(100, (usage.generations / plan.maxGenerationsPerMonth) * 100)}%`,
                      opacity: owner ? 0.35 : 1,
                    }}
                  />
                </div>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Projetos</p>
                <p className="mt-1 text-2xl font-bold">
                  {usage.projects}
                  <span className="text-sm font-normal text-muted-foreground"> / {formatLimit(plan.maxProjects)}</span>
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
