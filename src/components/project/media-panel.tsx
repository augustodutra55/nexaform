"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, ExternalLink, Film, Image as ImageIcon, Loader2, UploadCloud, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { AppFile } from "@/lib/engine/app-types";
import {
  buildMediaPrompt,
  findProjectMedia,
  type MediaKind,
  type ProjectMediaAsset,
  type ProjectMediaItem,
} from "@/lib/media/project-media";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface MediaPanelProps {
  projectId: string;
  projectName: string;
  files: AppFile[];
  assets: ProjectMediaAsset[];
  onReplace: (item: ProjectMediaItem, url: string) => Promise<void>;
  onAssetsChange: (assets: ProjectMediaAsset[]) => Promise<void>;
}

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime";
const MAX_BYTES = 50 * 1024 * 1024;

function kindOf(type: string): MediaKind {
  return type.startsWith("video/") ? "video" : "image";
}

export function MediaPanel({ projectId, projectName, files, assets, onReplace, onAssetsChange }: MediaPanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const items = useMemo(() => findProjectMedia(files, projectName), [files, projectName]);
  const [selectedId, setSelectedId] = useState(items[0]?.id || "");
  const selected = items.find((item) => item.id === selectedId) || items[0] || null;
  const [promptKind, setPromptKind] = useState<MediaKind>(selected?.kind || "image");
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedId && items[0]) setSelectedId(items[0].id);
    if (selectedId && !items.some((item) => item.id === selectedId)) setSelectedId(items[0]?.id || "");
  }, [items, selectedId]);

  useEffect(() => {
    if (selected) setPromptKind(selected.kind);
  }, [selected?.id, selected?.kind]);

  const prompt = buildMediaPrompt(selected, projectName, promptKind);

  async function copy(value: string, message: string) {
    await navigator.clipboard.writeText(value);
    toast.success(message);
  }

  async function upload(file: File) {
    if (!ACCEPT.split(",").includes(file.type)) {
      toast.error("Formato não permitido", { description: "Use PNG, JPG, WebP, GIF, MP4, WebM ou MOV." });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Arquivo maior que 50 MB");
      return;
    }

    setUploading(true);
    try {
      const response = await fetch(`/api/media-upload/${projectId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: file.name, type: file.type, size: file.size }),
      });
      const prepared = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(prepared.error || "Não foi possível preparar o upload.");

      const { error } = await supabase.storage
        .from("app-uploads")
        .uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type, cacheControl: "3600" });
      if (error) throw error;

      const asset: ProjectMediaAsset = {
        id: crypto.randomUUID(),
        url: prepared.publicUrl,
        path: prepared.path,
        name: file.name,
        type: file.type,
        size: file.size,
        createdAt: new Date().toISOString(),
      };
      await onAssetsChange([asset, ...assets].slice(0, 100));

      if (selected && selected.kind === kindOf(file.type)) {
        await onReplace(selected, asset.url);
        toast.success("Mídia enviada e substituída", { description: selected.context });
      } else {
        await navigator.clipboard.writeText(asset.url).catch(() => {});
        toast.success("Mídia salva na biblioteca", {
          description: selected ? "O tipo não combina com o item selecionado; a URL foi copiada." : "A URL foi copiada.",
        });
      }
    } catch (error: any) {
      toast.error("Não foi possível enviar a mídia", { description: error?.message });
    } finally {
      setUploading(false);
      setDragging(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-muted/20 p-4">
      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
        <section className="space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <WandSparkles className="h-5 w-5 text-brand-500" />
              <h2 className="font-semibold">Central de Mídia</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Escolha uma imagem, copie o prompt, gere no ChatGPT ou Genspark e arraste o resultado aqui.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={cn(
                  "overflow-hidden rounded-xl border bg-background text-left transition hover:border-brand-500/50",
                  selected?.id === item.id && "border-brand-500 ring-2 ring-brand-500/15"
                )}
              >
                <div className="flex aspect-video items-center justify-center overflow-hidden bg-secondary">
                  {item.kind === "image" && /^https?:\/\//i.test(item.source) ? (
                    <img src={item.source} alt="" className="h-full w-full object-cover" />
                  ) : item.kind === "video" && /^https?:\/\//i.test(item.source) ? (
                    <video src={item.source} className="h-full w-full object-cover" muted />
                  ) : item.kind === "video" ? (
                    <Film className="h-8 w-8 text-muted-foreground" />
                  ) : (
                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <div className="space-y-1 p-2.5">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">{item.kind === "video" ? "Vídeo" : "Imagem"}</Badge>
                    <span className="truncate text-[11px] text-muted-foreground">{item.filePath}</span>
                  </div>
                  <p className="line-clamp-2 text-sm font-medium">{item.context}</p>
                </div>
              </button>
            ))}
            {!items.length && (
              <div className="col-span-full rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
                Ainda não encontrei imagens ou vídeos estáticos no código. Você pode gerar o prompt e enviar a mídia para a biblioteca.
              </div>
            )}
          </div>

          <div className="rounded-xl border bg-background p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">Prompt pronto</h3>
                <p className="text-xs text-muted-foreground">Já inclui o contexto do bloco selecionado.</p>
              </div>
              <div className="inline-flex rounded-lg border p-0.5 text-xs">
                <button onClick={() => setPromptKind("image")} className={cn("rounded-md px-2.5 py-1", promptKind === "image" && "bg-secondary font-medium")}>Imagem</button>
                <button onClick={() => setPromptKind("video")} className={cn("rounded-md px-2.5 py-1", promptKind === "video" && "bg-secondary font-medium")}>Vídeo</button>
              </div>
            </div>
            <Textarea value={prompt} readOnly className="min-h-28 resize-none text-xs" />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => copy(prompt, "Prompt copiado")}><Copy /> Copiar prompt</Button>
              <Button size="sm" variant="outline" asChild><a href="https://chatgpt.com/" target="_blank" rel="noreferrer">ChatGPT <ExternalLink /></a></Button>
              <Button size="sm" variant="outline" asChild><a href="https://www.genspark.ai/" target="_blank" rel="noreferrer">Genspark <ExternalLink /></a></Button>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files[0];
              if (file) upload(file);
            }}
            className={cn(
              "flex min-h-48 flex-col items-center justify-center rounded-xl border-2 border-dashed bg-background p-6 text-center transition",
              dragging && "border-brand-500 bg-brand-500/5"
            )}
          >
            {uploading ? <Loader2 className="h-9 w-9 animate-spin text-brand-500" /> : <UploadCloud className="h-9 w-9 text-brand-500" />}
            <p className="mt-3 text-sm font-semibold">{uploading ? "Enviando…" : "Arraste o arquivo gerado"}</p>
            <p className="mt-1 text-xs text-muted-foreground">Imagem ou vídeo de até 50 MB</p>
            <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />
            <Button className="mt-4" size="sm" variant="outline" disabled={uploading} onClick={() => inputRef.current?.click()}>
              Escolher arquivo
            </Button>
            {selected && <p className="mt-3 text-xs text-muted-foreground">Substituirá: <strong className="text-foreground">{selected.context}</strong></p>}
          </div>

          <div className="rounded-xl border bg-background p-4">
            <h3 className="text-sm font-semibold">Biblioteca do projeto</h3>
            <p className="mb-3 text-xs text-muted-foreground">Arquivos já enviados e prontos para reutilizar.</p>
            <div className="max-h-[430px] space-y-2 overflow-y-auto">
              {assets.map((asset) => {
                const assetKind = kindOf(asset.type);
                return (
                  <div key={asset.id} className="flex gap-3 rounded-lg border p-2">
                    <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary">
                      {assetKind === "image" ? <img src={asset.url} alt="" className="h-full w-full object-cover" /> : <Film className="h-6 w-6 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{asset.name}</p>
                      <p className="text-[11px] text-muted-foreground">{assetKind === "video" ? "Vídeo" : "Imagem"} · {(asset.size / 1024 / 1024).toFixed(1)} MB</p>
                      <div className="mt-1 flex gap-1">
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => copy(asset.url, "URL copiada")}><Copy /> URL</Button>
                        {selected && selected.kind === assetKind && (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onReplace(selected, asset.url)}>Usar aqui</Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {!assets.length && <p className="py-6 text-center text-xs text-muted-foreground">Nenhuma mídia enviada ainda.</p>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
