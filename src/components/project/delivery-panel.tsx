"use client";

import { useMemo, useState } from "react";
import { Check, Circle, Copy, ExternalLink, Loader2, PackageCheck, Rocket } from "lucide-react";
import { toast } from "sonner";
import type { ProjectMeta } from "@/lib/studio";
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
  const [open, setOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [publishedSlug, setPublishedSlug] = useState<string | null>(props.shareSlug);
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
            Configure a marca, publique a versão aprovada e gere o pacote comercial de {props.projectName}.
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
            <div className="space-y-1.5">
              <Label>Domínio desejado</Label>
              <Input defaultValue={props.meta.delivery?.customDomain || ""} onBlur={(event) => changeDelivery({ customDomain: event.target.value.trim() })} placeholder="app.cliente.com.br" />
              <p className="text-xs text-muted-foreground">Registrar aqui não altera o DNS. Conecte o domínio no provedor de hospedagem e depois configure os registros indicados por ele.</p>
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
