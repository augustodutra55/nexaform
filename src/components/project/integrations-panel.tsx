"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

type Provider = "stripe" | "resend" | "automation" | "inbound";
type Status = { id: Provider; configured: boolean; source: "project" | "platform" | "none"; hint?: string; updatedAt?: string };

const details: Record<Provider, { title: string; description: string }> = {
  stripe: { title: "Stripe", description: "Pagamentos e assinaturas pertencentes a este projeto." },
  resend: { title: "Resend", description: "E-mails de contato, lembretes e notificações." },
  automation: { title: "Webhooks", description: "Endpoints HTTPS autorizados para n8n, Make ou automações próprias." },
  inbound: { title: "Entrada de e-mails", description: "Receba eventos normalizados do Gmail, Make, Zapier ou n8n com revisão humana obrigatória." },
};

export function IntegrationsPanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [stripeKey, setStripeKey] = useState("");
  const [resendKey, setResendKey] = useState("");
  const [resendFrom, setResendFrom] = useState("");
  const [targets, setTargets] = useState("");
  const [inboundSecret, setInboundSecret] = useState("");
  const [inboundEndpoints, setInboundEndpoints] = useState<Array<{ name: string; collection: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/integrations/${projectId}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Falha ao consultar integrações.");
      setStatuses(json.integrations || []);
      setInboundEndpoints(json.inbound || []);
    } catch (error: any) {
      toast.error("Não foi possível consultar as integrações", { description: error?.message });
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  async function run(provider: Provider, action: "secret.save" | "secret.remove") {
    const config = provider === "stripe" ? { secretKey: stripeKey }
      : provider === "resend" ? { apiKey: resendKey, from: resendFrom }
      : provider === "automation" ? { targets: targets.split(/[,\n]/).map((item) => item.trim()).filter(Boolean) }
      : { secret: inboundSecret };
    setLoading(true);
    try {
      const response = await fetch(`/api/integrations/${projectId}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, provider, config }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Não foi possível salvar a integração.");
      setStatuses(json.integrations || []);
      setStripeKey(""); setResendKey(""); setResendFrom(""); setTargets("");
      toast.success(action === "secret.save" ? "Integração protegida no cofre" : "Credencial própria removida");
    } catch (error: any) {
      toast.error("Integração não atualizada", { description: error?.message });
    } finally { setLoading(false); }
  }

  async function rotateInbound() {
    setLoading(true);
    try {
      const response = await fetch(`/api/integrations/${projectId}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "inbound.rotate" }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Não foi possível gerar o segredo.");
      setStatuses(json.integrations || []);
      setInboundSecret(json.secret || "");
      toast.success("Segredo gerado", { description: "Copie agora: ele não será exibido novamente." });
    } catch (error: any) {
      toast.error("Entrada externa não atualizada", { description: error?.message });
    } finally { setLoading(false); }
  }

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copiado`);
  }

  function status(provider: Provider) { return statuses.find((item) => item.id === provider); }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Integrações do projeto" title="Integrações e credenciais"><KeyRound /></Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Integrações do projeto</DialogTitle>
          <DialogDescription>As chaves são criptografadas no servidor e nunca aparecem no código gerado ou nas respostas da API.</DialogDescription>
        </DialogHeader>
        {loading && !statuses.length ? (
          <div className="flex justify-center py-10 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Consultando cofre…</div>
        ) : (
          <div className="space-y-4">
            {(["stripe", "resend", "automation", "inbound"] as Provider[]).map((provider) => {
              const current = status(provider);
              return (
                <section key={provider} className="space-y-3 rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="font-medium">{details[provider].title}</p><p className="text-xs text-muted-foreground">{details[provider].description}</p></div>
                    <span className="rounded-full border px-2 py-1 text-[11px]">
                      {current?.source === "project" ? `Própria ${current.hint || ""}` : current?.source === "platform" ? "Plataforma" : "Não configurada"}
                    </span>
                  </div>
                  {provider === "stripe" && <div className="space-y-2"><Label>Chave secreta Stripe</Label><Input type="password" autoComplete="new-password" value={stripeKey} onChange={(e) => setStripeKey(e.target.value)} placeholder="sk_test_… ou sk_live_…" /></div>}
                  {provider === "resend" && <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>API key Resend</Label><Input type="password" autoComplete="new-password" value={resendKey} onChange={(e) => setResendKey(e.target.value)} placeholder="re_…" /></div><div className="space-y-2"><Label>Remetente</Label><Input value={resendFrom} onChange={(e) => setResendFrom(e.target.value)} placeholder="Empresa <contato@dominio.com>" /></div></div>}
                  {provider === "automation" && <div className="space-y-2"><Label>Webhooks autorizados</Label><Textarea value={targets} onChange={(e) => setTargets(e.target.value)} rows={3} placeholder="https://n8n.exemplo.com/webhook/…\nUm endpoint por linha" /></div>}
                  {provider === "inbound" && <div className="space-y-3">
                    <div className="space-y-2"><Label>URL do webhook</Label>{(inboundEndpoints.length ? inboundEndpoints : [{ name: "{nome-do-endpoint}", collection: "declare no AD_BACKEND" }]).map((endpoint) => { const url = `${typeof window === "undefined" ? "" : window.location.origin}/api/inbound/${projectId}/${endpoint.name}`; return <div key={endpoint.name} className="space-y-1"><div className="flex gap-2"><Input readOnly value={url} /><Button type="button" variant="outline" size="icon" aria-label={`Copiar URL ${endpoint.name}`} onClick={() => void copy(`${window.location.origin}/api/inbound/${projectId}/${endpoint.name}`, "URL")}><Copy /></Button></div><p className="text-[11px] text-muted-foreground">Coleção: {endpoint.collection}</p></div>; })}</div>
                    <p className="text-xs text-muted-foreground">Declare o nome e a coleção no AD_BACKEND. Envie JSON com <code>externalId</code> e o cabeçalho <code>x-adstudio-secret</code>. Todo evento entra como pendente de revisão.</p>
                    {inboundSecret && <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30"><Label>Segredo — exibido uma única vez</Label><div className="flex gap-2"><Input readOnly value={inboundSecret} /><Button type="button" variant="outline" size="icon" aria-label="Copiar segredo" onClick={() => void copy(inboundSecret, "Segredo")}><Copy /></Button></div></div>}
                  </div>}
                  <div className="flex gap-2">
                    {provider === "inbound" ? <Button size="sm" onClick={() => void rotateInbound()} disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} {current?.source === "project" ? "Girar segredo" : "Gerar segredo"}</Button> : <Button size="sm" onClick={() => void run(provider, "secret.save")} disabled={loading || (provider === "stripe" && !stripeKey) || (provider === "resend" && !resendKey) || (provider === "automation" && !targets.trim())}>{loading ? <Loader2 className="animate-spin" /> : <Save />} Salvar no cofre</Button>}
                    {current?.source === "project" && <Button variant="ghost" size="sm" onClick={() => void run(provider, "secret.remove")} disabled={loading}><Trash2 /> {provider === "inbound" ? "Desativar entrada" : "Usar padrão da plataforma"}</Button>}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
