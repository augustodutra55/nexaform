"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Check, Circle, Copy, ExternalLink, Globe2, Loader2, PackageCheck, RefreshCw, Rocket, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ProjectMeta } from "@/lib/studio";
import type { CustomDomainSnapshot } from "@/lib/delivery/custom-domain";
import { buildDeliveryChecklist, deliveryIsReady } from "@/lib/delivery/commercial-handoff";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

interface DeliveryPanelProps {
  projectName: string;
  published: boolean;
  shareSlug: string | null;
  canExport: boolean;
  qualityRequired: boolean;
  meta: ProjectMeta;
  onMetaChange: (patch: Partial<ProjectMeta>) => void;
  onPublish: () => Promise<string | null>;
  onExport: () => Promise<void>;
}

export function DeliveryPanel(props: DeliveryPanelProps) {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const [open, setOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [publishedSlug, setPublishedSlug] = useState<string | null>(props.shareSlug);
  const [domainDraft, setDomainDraft] = useState(props.meta.delivery?.customDomain || "");
  const [domainBusy, setDomainBusy] = useState(false);
  const [domainStatus, setDomainStatus] = useState<CustomDomainSnapshot | null>(props.meta.delivery?.customDomainStatus || null);
  const [domainIntegrationConfigured, setDomainIntegrationConfigured] = useState<boolean | null>(null);
  const effectiveSlug = publishedSlug || props.shareSlug;
  const effectivePublished = props.published || !!publishedSlug;
  const checklist = useMemo(() => buildDeliveryChecklist({
    meta: props.meta,
    published: effectivePublished,
    shareSlug: effectiveSlug,
    canExport: props.canExport,
    qualityRequired: props.qualityRequired,
  }), [props.meta, effectivePublished, effectiveSlug, props.canExport, props.qualityRequired]);
  const ready = deliveryIsReady(checklist);
  const publicUrl = effectiveSlug && typeof window !== "undefined" ? `${window.location.origin}/p/${effectiveSlug}` : null;

  function changeDelivery(patch: NonNullable<ProjectMeta["delivery"]>) {
    props.onMetaChange({ delivery: { ...(props.meta.delivery || {}), ...patch } });
  }

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    void fetch(`/api/domains/${projectId}`, { cache: "no-store" })
      .then(async (response) => ({ ok: response.ok, data: await response.json().catch(() => null) }))
      .then(({ ok, data }) => {
        if (cancelled || !ok || !data) return;
        setDomainIntegrationConfigured(data.integrationConfigured === true);
        if (typeof data.domain === "string" && data.domain) setDomainDraft(data.domain);
        setDomainStatus(data.status || null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, projectId]);

  async function publish() {
    setPublishing(true);
    const slug = await props.onPublish();
    setPublishing(false);
    if (slug) {
      setPublishedSlug(slug);
      toast.success("Versão comercial publicada");
    }
  }

  async function copyLink() {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    toast.success("Link do cliente copiado");
  }

  async function exportPackage() {
    setExporting(true);
    await props.onExport();
    setExporting(false);
  }

  async function manageDomain(action: "attach" | "verify" | "refresh") {
    if (!projectId) return;
    setDomainBusy(true);
    try {
      const response = await fetch(`/api/domains/${projectId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, domain: domainDraft }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Não foi possível configurar o domínio.");
      setDomainDraft(data.domain);
      setDomainStatus(data.status || null);
      setDomainIntegrationConfigured(true);
      changeDelivery({ customDomain: data.domain, customDomainStatus: data.status });
      toast.success(action === "attach" ? "Domínio conectado" : action === "verify" ? "Verificação solicitada" : "Status do domínio atualizado");
    } catch (error: any) {
      toast.error(error?.message || "Falha ao configurar domínio.");
    } finally {
      setDomainBusy(false);
    }
  }

  async function removeDomain() {
    if (!projectId || !domainDraft) return;
    setDomainBusy(true);
    try {
      const response = await fetch(`/api/domains/${projectId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: domainDraft }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Não foi possível remover o domínio.");
      setDomainDraft("");
      setDomainStatus(null);
      props.onMetaChange({ delivery: { ...(props.meta.delivery || {}), customDomain: undefined, customDomainStatus: undefined } });
      toast.success("Domínio removido do projeto");
    } catch (error: any) {
      toast.error(error?.message || "Falha ao remover domínio.");
    } finally {
      setDomainBusy(false);
    }
  }

  function markDelivered() {
    if (!ready) {
      toast.error("Conclua os itens obrigatórios antes de marcar a entrega.");
      return;
    }
    props.onMetaChange({
      status: "entregue",
      delivery: { ...(props.meta.delivery || {}), deliveredAt: new Date().toISOString() },
    });
    toast.success("Entrega registrada no projeto");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Central de entrega" title="Central de entrega">
          <PackageCheck />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Central de entrega comercial</DialogTitle>
          <DialogDescription>
            Configure a marca, publique a versão aprovada, conecte o domínio e gere o pacote comercial de {props.projectName}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-2">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Identidade do cliente</h3>
            <div className="space-y-1.5">
              <Label>Nome comercial</Label>
              <Input defaultValue={props.meta.client || ""} onBlur={(event) => props.onMetaChange({ client: event.target.value.trim() })} placeholder="Ex.: AutoCare Veículos" />
            </div>
            <div className="space-y-1.5">
              <Label>Logo (URL HTTPS)</Label>
              <Input defaultValue={props.meta.delivery?.logoUrl || ""} onBlur={(event) => changeDelivery({ logoUrl: event.target.value.trim() })} placeholder="https://..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Cor principal</Label>
                <Input defaultValue={props.meta.delivery?.primaryColor || ""} onBlur={(event) => changeDelivery({ primaryColor: event.target.value.trim() })} placeholder="#2563eb" />
              </div>
              <div className="space-y-1.5">
                <Label>E-mail de contato</Label>
                <Input type="email" defaultValue={props.meta.delivery?.contactEmail || ""} onBlur={(event) => changeDelivery({ contactEmail: event.target.value.trim() })} placeholder="cliente@empresa.com" />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">White-label</p>
                <p className="text-xs text-muted-foreground">Remove a marca AD Studio da publicação.</p>
              </div>
              <Switch checked={!!props.meta.whitelabel} onCheckedChange={(checked) => props.onMetaChange({ whitelabel: checked })} />
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Globe2 className="h-4 w-4" />
                <Label>Domínio personalizado</Label>
              </div>
              <Input value={domainDraft} onChange={(event) => setDomainDraft(event.target.value)} placeholder="app.cliente.com.br" />
              {!effectivePublished && <p className="text-xs text-amber-600">Publique a versão aprovada antes de conectar o domínio.</p>}
              {domainIntegrationConfigured === false && <p className="text-xs text-muted-foreground">A integração Vercel ainda não está configurada no servidor.</p>}
              {domainStatus && (
                <div className="rounded-md bg-secondary/50 p-2 text-xs">
                  <p className="font-medium">{domainStatus.name}</p>
                  <p className={domainStatus.verified ? "text-emerald-600" : "text-amber-600"}>
                    {domainStatus.verified ? "Domínio verificado" : "Aguardando verificação"} · {domainStatus.configured ? "configuração reconhecida" : "DNS ainda incorreto"}
                  </p>
                  {!!domainStatus.verification?.length && (
                    <div className="mt-2 space-y-1 text-muted-foreground">
                      {domainStatus.verification.map((item, index) => (
                        <p key={`${item.type || "dns"}-${index}`}>{item.type || "DNS"}: {item.domain || domainStatus.name} {item.value ? `→ ${item.value}` : item.reason || "aguardando"}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={() => manageDomain(domainStatus ? "refresh" : "attach")} disabled={domainBusy || !effectivePublished || !domainDraft.trim()}>
                  {domainBusy ? <Loader2 className="animate-spin" /> : domainStatus ? <RefreshCw /> : <Globe2 />}
                  {domainStatus ? "Atualizar status" : "Conectar domínio"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => manageDomain("verify")} disabled={domainBusy || !domainStatus || domainStatus.verified}>
                  <Check /> Verificar
                </Button>
              </div>
              {domainStatus && (
                <Button variant="ghost" size="sm" className="w-full text-destructive" onClick={removeDomain} disabled={domainBusy}>
                  <Trash2 /> Remover domínio
                </Button>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Notas de handoff</Label>
              <Textarea rows={3} defaultValue={props.meta.delivery?.handoffNotes || ""} onBlur={(event) => changeDelivery({ handoffNotes: event.target.value })} placeholder="Acessos, responsáveis, suporte e próximos passos…" />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Checklist de liberação</h3>
            <div className="space-y-2">
              {checklist.map((item) => (
                <div key={item.id} className="flex gap-3 rounded-lg border p-3">
                  {item.complete ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                  <div>
                    <p className="text-sm font-medium">{item.label}{item.required ? " *" : ""}</p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2 rounded-lg border bg-secondary/30 p-3">
              <p className="text-sm font-medium">Versão do cliente</p>
              {publicUrl ? (
                <div className="flex items-center gap-2">
                  <Input readOnly value={publicUrl} className="h-8 text-xs" />
                  <Button variant="outline" size="icon" onClick={copyLink} aria-label="Copiar link"><Copy /></Button>
                  <Button variant="outline" size="icon" asChild aria-label="Abrir publicação"><a href={publicUrl} target="_blank" rel="noreferrer"><ExternalLink /></a></Button>
                </div>
              ) : <p className="text-xs text-muted-foreground">Publique a versão aprovada para gerar o link final.</p>}
              <Button variant="outline" className="w-full" onClick={publish} disabled={publishing}>
                {publishing ? <Loader2 className="animate-spin" /> : <Rocket />}
                {effectivePublished ? "Atualizar publicação" : "Publicar versão aprovada"}
              </Button>
            </div>
          </section>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={exportPackage} disabled={!props.canExport || exporting}>
            {exporting ? <Loader2 className="animate-spin" /> : <PackageCheck />}
            Baixar pacote comercial
          </Button>
          <Button variant="brand" onClick={markDelivered} disabled={!ready}>
            <Check /> Marcar como entregue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
