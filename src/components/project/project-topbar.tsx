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
} from "lucide-react";
import { useProjectStore } from "@/lib/store/project";
import { timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  versions: VersionRow[];
  onRename: (name: string) => void;
  onRestoreVersion: (v: VersionRow) => void;
  onPublish: () => Promise<string | null>;
  onExport: () => void;
  onToggleEditor: () => void;
}

export function ProjectTopbar({
  name,
  published,
  shareSlug,
  canExport,
  versions,
  onRename,
  onRestoreVersion,
  onPublish,
  onExport,
  onToggleEditor,
}: TopbarProps) {
  const { saveState, past, future, undo, redo } = useProjectStore();
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);

  async function handleShare() {
    let slug = shareSlug;
    if (!published || !slug) {
      setPublishing(true);
      slug = await onPublish();
      setPublishing(false);
      if (!slug) return;
    }
    const url = `${location.origin}/p/${slug}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link copiado!", { description: url });
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
        <Badge variant={published ? "success" : "secondary"} className="hidden sm:inline-flex">
          {published ? "Publicado" : "Rascunho"}
        </Badge>
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
        <Button variant="ghost" size="icon" onClick={() => setVersionsOpen(true)} aria-label="Histórico de versões" title="Histórico de versões">
          <History />
        </Button>
        <Button variant="ghost" size="icon" onClick={onExport} aria-label="Exportar projeto" title="Exportar projeto">
          <Download />
        </Button>
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
              Cada geração cria uma versão. Restaure qualquer uma — o estado atual vai para o undo.
            </DialogDescription>
          </DialogHeader>
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
    </div>
  );
}
