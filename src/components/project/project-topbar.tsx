"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  Undo2,
  Redo2,
  History,
  Download,
  Globe,
  Share2,
  Check,
  Loader2,
  PanelRight,
  CloudUpload,
  ClipboardList,
  Save,
} from "lucide-react";
import { useProjectStore } from "@/lib/store/project";
import { timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProjectMeta, ProjectStatus, STATUS_LABEL, STATUS_ORDER, STATUS_STYLE } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { DeliveryPanel } from "@/components/project/delivery-panel";

export interface VersionRow {
  id: string;
  label: string;
  created_at: string;
  schema: any;
}

interface TopbarProps {
  name: string;
  published: boolean;
  shareSlug: string | null;
  canExport: boolean;
  qualityRequired: boolean;
  versions: VersionRow[];
  meta: ProjectMeta;
  studio: boolean;
  onRename: (name: string) => void;
  onRestoreVersion: (v: VersionRow) => void;
  onPublish: () => Promise<string | null>;
  onExport: () => void;
  onCommercialExport: () => Promise<void>;
  onToggleEditor: () => void;
  onMetaChange: (patch: Partial<ProjectMeta>) => void;
  onSaveVersion: (label: string) => Promise<void>;
}

export function ProjectTopbar({
  name,
  published,
  shareSlug,
  canExport,
  qualityRequired,
  versions,
  meta,
  studio,
  onRename,
  onRestoreVersion,
  onPublish,
  onExport,
  onCommercialExport,
  onToggleEditor,
  onMetaChange,
  onSaveVersion,
}: TopbarProps) {
  const { saveState, past, future, undo, redo } = useProjectStore();
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [versionName, setVersionName] = useState("");
  const status: ProjectStatus = meta.status ?? "rascunho";

  async function handleShare() {
    // SEMPRE republica o código atual (recompila o build_bundle) — assim as
    // alterações feitas DEPOIS da 1ª publicação realmente vão pro ar. O slug é
    // reutilizado, então o link não muda. Antes, quando já publicado, só copiava
    // o link e a versão no ar ficava velha.
    setPublishing(true);
    const slug = await onPublish();
    setPublishing(false);
    if (!slug) return;
    const url = `${location.origin}/p/${slug}`;
    await navigator.clipboard.writeText(url);
    toast.success(published ? "Publicação atualizada — link copiado!" : "Publicado — link copiado!", {
      description: url,
    });
  }

  return (
    <div className="flex h-12 items-center justify-between border-b bg-background px-3">
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="icon" asChild aria-label="Voltar ao dashboard">
          <Link href="/dashboard">
            <ArrowLeft />
          </Link>
        </Button>
        <input
          className="w-44 truncate bg-transparent text-sm font-medium outline-none focus:underline md:w-64"
          defaultValue={name}
          onBlur={(e) => e.target.value.trim() && e.target.value !== name && onRename(e.target.value.trim())}
          aria-label="Nome do projeto"
        />
        {studio ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "hidden shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80 sm:inline-flex",
                  STATUS_STYLE[status]
                )}
                title="Status de produção"
              >
                {STATUS_LABEL[status]}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {STATUS_ORDER.map((s) => (
                <DropdownMenuItem key={s} onClick={() => onMetaChange({ status: s })}>
                  <span className={cn("mr-2 h-2 w-2 rounded-full", STATUS_STYLE[s])} />
                  {STATUS_LABEL[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Badge variant={published ? "success" : "secondary"} className="hidden sm:inline-flex">
            {published ? "Publicado" : "Rascunho"}
          </Badge>
        )}
        <span className="hidden items-center gap-1 text-xs text-muted-foreground md:flex">
          {saveState === "saving" ? (
            <>
              <CloudUpload className="h-3.5 w-3.5 animate-pulse-soft" /> Salvando…
            </>
          ) : saveState === "dirty" ? (
            <>
              <CloudUpload className="h-3.5 w-3.5" /> Alterações pendentes
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-500" /> Salvo
            </>
          )}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={undo} disabled={past.length === 0} aria-label="Desfazer" title="Desfazer (⌘Z)">
          <Undo2 />
        </Button>
        <Button variant="ghost" size="icon" onClick={redo} disabled={future.length === 0} aria-label="Refazer" title="Refazer (⌘⇧Z)">
          <Redo2 />
        </Button>
        {studio && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDetailsOpen(true)}
            aria-label="Detalhes de produção"
            title="Briefing / observações internas"
          >
            <ClipboardList />
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={() => setVersionsOpen(true)} aria-label="Histórico de versões" title="Histórico de versões">
          <History />
        </Button>
        <Button variant="ghost" size="icon" onClick={onExport} aria-label="Exportar projeto" title="Exportar projeto">
          <Download />
        </Button>
        {studio && (
          <DeliveryPanel
            projectName={name}
            published={published}
            shareSlug={shareSlug}
            canExport={canExport}
            qualityRequired={qualityRequired}
            meta={meta}
            onMetaChange={onMetaChange}
            onPublish={onPublish}
            onExport={onCommercialExport}
          />
        )}
        <Button variant="ghost" size="icon" onClick={onToggleEditor} aria-label="Alternar editor" title="Editor visual" className="hidden lg:inline-flex">
          <PanelRight />
        </Button>
        <Button variant="brand" size="sm" onClick={handleShare} disabled={publishing} className="ml-1">
          {publishing ? <Loader2 className="animate-spin" /> : published ? <Share2 /> : <Globe />}
          {published ? "Compartilhar" : "Publicar"}
        </Button>
      </div>

      {/* Histórico de versões */}
      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}>
        <DialogContent className="max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Histórico de versões</DialogTitle>
            <DialogDescription>
              Cada geração cria uma versão. Salve marcos com nome e restaure quando quiser.
            </DialogDescription>
          </DialogHeader>

          {/* Salvar versão atual com nome manual */}
          <div className="flex items-end gap-2 rounded-lg border bg-secondary/30 p-3">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Salvar versão atual</Label>
              <Input
                value={versionName}
                onChange={(e) => setVersionName(e.target.value)}
                placeholder="Ex.: cliente aprovou o hero"
                className="h-8"
              />
            </div>
            <Button
              size="sm"
              onClick={async () => {
                await onSaveVersion(versionName.trim() || "Marco manual");
                setVersionName("");
                toast.success("Versão salva no histórico");
              }}
            >
              <Save className="h-3.5 w-3.5" /> Salvar
            </Button>
          </div>

          <div className="space-y-2">
            {versions.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhuma versão ainda. Gere algo pelo chat para começar o histórico.
              </p>
            )}
            {versions.map((v, i) => (
              <div key={v.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{v.label || `Versão ${versions.length - i}`}</p>
                  <p className="text-xs text-muted-foreground">{timeAgo(v.created_at)}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onRestoreVersion(v);
                    setVersionsOpen(false);
                    toast.success("Versão restaurada");
                  }}
                >
                  Restaurar
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Detalhes de produção (briefing / notas internas) */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Detalhes de produção</DialogTitle>
            <DialogDescription>Informações internas — não aparecem na entrega ao cliente.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">Cliente / rótulo</Label>
              <Input
                defaultValue={meta.client ?? ""}
                onBlur={(e) => onMetaChange({ client: e.target.value })}
                placeholder="Ex.: Clínica Sorriso Perfeito"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Observações internas</Label>
              <Textarea
                defaultValue={meta.notes ?? ""}
                onBlur={(e) => onMetaChange({ notes: e.target.value })}
                rows={5}
                placeholder="Escopo, prazos, pendências, o que o cliente pediu…"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Entrega white-label</p>
                <p className="text-xs text-muted-foreground">Publicar sem a marca AD Studio, como entrega do cliente.</p>
              </div>
              <Switch
                checked={!!meta.whitelabel}
                onCheckedChange={(v) => onMetaChange({ whitelabel: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="brand" onClick={() => setDetailsOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
