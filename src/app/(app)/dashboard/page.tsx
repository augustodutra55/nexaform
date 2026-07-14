"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  Copy,
  Trash2,
  Sparkles,
  Globe,
  Loader2,
  ArrowUp,
  Mic,
  Square,
  LayoutTemplate,
  Bookmark,
  Paperclip,
  X,
  FileCode2,
  Image as ImageIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/utils";
import { resolvePlan, isOwner, type AccessProfile } from "@/lib/access";
import { readMeta, STATUS_LABEL, STATUS_STYLE, STARTER_TEMPLATES } from "@/lib/studio";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSpeechInput } from "@/hooks/use-speech-input";
import {
  attachmentPayloadBytes,
  MAX_PROMPT_ATTACHMENTS,
  MAX_PROMPT_TOTAL_BYTES,
  preparePromptAttachment,
  PROMPT_ATTACHMENT_ACCEPT,
  type PromptAttachment,
} from "@/lib/engine/prompt-attachments";

interface Project {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
  published: boolean;
  schema: unknown;
  meta: any;
}

export default function DashboardPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [query, setQuery] = useState("");
  const [access, setAccess] = useState<AccessProfile>({});
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [quickPrompt, setQuickPrompt] = useState("");
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  // Comando por voz com mensagens claras para permissão/dispositivo.
  const { listening, supported: voiceSupported, toggle: toggleMic } = useSpeechInput({ value: quickPrompt, onChange: setQuickPrompt });

  async function addAttachments(fileList: FileList | null) {
    if (!fileList?.length) return;
    const slots = Math.max(0, MAX_PROMPT_ATTACHMENTS - attachments.length);
    if (!slots) {
      toast.error(`Você pode anexar até ${MAX_PROMPT_ATTACHMENTS} arquivos por pedido.`);
      return;
    }
    const prepared: PromptAttachment[] = [];
    for (const file of Array.from(fileList).slice(0, slots)) {
      try {
        prepared.push(await preparePromptAttachment(file));
      } catch (error) {
        toast.error(`Não foi possível anexar ${file.name}`, {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    }
    if (prepared.length) {
      setAttachments((current) => {
        let total = current.reduce((sum, item) => sum + attachmentPayloadBytes(item), 0);
        const accepted: PromptAttachment[] = [];
        for (const item of prepared) {
          const bytes = attachmentPayloadBytes(item);
          if (total + bytes > MAX_PROMPT_TOTAL_BYTES) {
            toast.error("Os anexos ficaram grandes demais juntos", { description: "Remova um arquivo ou use referências menores." });
            continue;
          }
          total += bytes;
          accepted.push(item);
        }
        return current.concat(accepted).slice(0, MAX_PROMPT_ATTACHMENTS);
      });
    }
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  }

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, description, updated_at, published, schema, meta")
      .order("updated_at", { ascending: false });
    if (error) {
      toast.error("Não foi possível carregar seus projetos");
      setProjects([]);
      return;
    }
    setProjects(data ?? []);
    const [{ data: sub }, { data: prof }, { data: userData }] = await Promise.all([
      supabase.from("subscriptions").select("plan").maybeSingle(),
      supabase.from("profiles").select("role").maybeSingle(),
      supabase.auth.getUser(),
    ]);
    setAccess({ plan: sub?.plan, role: prof?.role, email: userData.user?.email });
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!projects) return null;
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q)
    );
  }, [projects, query]);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const plan = resolvePlan(access);
    if (plan.maxProjects !== -1 && (projects?.length ?? 0) >= plan.maxProjects) {
      toast.error(`Limite de ${plan.maxProjects} projetos no plano ${plan.name}`, {
        description: "Faça upgrade para criar projetos ilimitados.",
        action: { label: "Ver planos", onClick: () => router.push("/pricing") },
      });
      return;
    }
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("projects")
      .insert({
        user_id: userData.user!.id,
        name: String(form.get("name")),
        description: String(form.get("description") || ""),
        schema: null,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error || !data) {
      toast.error("Não foi possível criar o projeto");
      return;
    }
    setCreateOpen(false);
    router.push(`/projeto/${data.id}`);
  }

  /** Criação prompt-first: digitou, entrou construindo. */
  async function handleQuickCreate(e: React.FormEvent) {
    e.preventDefault();
    const prompt = quickPrompt.trim();
    if (!prompt || busy) return;
    const plan = resolvePlan(access);
    if (plan.maxProjects !== -1 && (projects?.length ?? 0) >= plan.maxProjects) {
      toast.error(`Limite de ${plan.maxProjects} projetos no plano ${plan.name}`, {
        description: "Faça upgrade para criar projetos ilimitados.",
        action: { label: "Ver planos", onClick: () => router.push("/pricing") },
      });
      return;
    }
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("projects")
      .insert({
        user_id: userData.user!.id,
        name: prompt.slice(0, 48),
        description: prompt.slice(0, 240),
        schema: null,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error || !data) {
      toast.error("Não foi possível criar o projeto");
      return;
    }
    sessionStorage.setItem(`nexaform:starter:${data.id}`, prompt);
    if (attachments.length) {
      try {
        sessionStorage.setItem(`nexaform:starter-attachments:${data.id}`, JSON.stringify(attachments));
      } catch {
        toast.error("Os anexos não couberam no navegador", { description: "Abra o projeto e anexe-os novamente no chat." });
      }
    }
    router.push(`/projeto/${data.id}`);
  }

  async function handleRename(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!renameTarget) return;
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name"));
    const { error } = await supabase
      .from("projects")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", renameTarget.id);
    setBusy(false);
    if (error) {
      toast.error("Não foi possível renomear");
      return;
    }
    setRenameTarget(null);
    toast.success("Projeto renomeado");
    load();
  }

  async function handleDuplicate(p: Project) {
    const plan = resolvePlan(access);
    if (plan.maxProjects !== -1 && (projects?.length ?? 0) >= plan.maxProjects) {
      toast.error(`Limite de projetos do plano ${plan.name} atingido`);
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("projects").insert({
      user_id: userData.user!.id,
      name: `${p.name} (cópia)`,
      description: p.description,
      schema: p.schema,
    });
    if (error) {
      toast.error("Não foi possível duplicar");
      return;
    }
    toast.success("Projeto duplicado");
    load();
  }

  async function handleSaveAsTemplate(p: Project) {
    const meta = { ...readMeta(p.meta), template: true };
    const { error } = await supabase.from("projects").update({ meta }).eq("id", p.id);
    if (error) {
      toast.error("Não foi possível salvar como modelo");
      return;
    }
    toast.success("Salvo como modelo", { description: "Aparece em “Começar de um modelo”." });
    load();
  }

  /** Cria projeto a partir de um modelo embutido (gera pela IA) ou de um projeto-modelo (copia schema). */
  async function handleCreateFrom(opts: { prompt?: string; schema?: unknown; name: string }) {
    const plan = resolvePlan(access);
    if (plan.maxProjects !== -1 && (projects?.length ?? 0) >= plan.maxProjects) {
      toast.error(`Limite de ${plan.maxProjects} projetos no plano ${plan.name}`);
      return;
    }
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("projects")
      .insert({
        user_id: userData.user!.id,
        name: opts.name,
        description: opts.prompt?.slice(0, 240) ?? "",
        schema: opts.schema ?? null,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error || !data) {
      toast.error("Não foi possível criar o projeto");
      return;
    }
    setGalleryOpen(false);
    // modelo embutido → dispara a geração pela IA na tela do projeto
    if (opts.prompt && !opts.schema) sessionStorage.setItem(`nexaform:starter:${data.id}`, opts.prompt);
    router.push(`/projeto/${data.id}`);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    const { error } = await supabase.from("projects").delete().eq("id", deleteTarget.id);
    setBusy(false);
    if (error) {
      toast.error("Não foi possível excluir");
      return;
    }
    setDeleteTarget(null);
    toast.success("Projeto excluído");
    load();
  }

  return (
    <div className="container max-w-6xl py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{isOwner(access) ? "Estúdio de produção" : "Seus projetos"}</h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {projects ? `${projects.length} projeto${projects.length === 1 ? "" : "s"}` : "Carregando…"}
            {isOwner(access) ? (
              <Badge className="gap-1">Studio · acesso total</Badge>
            ) : (
              <span>
                · plano <span className="capitalize">{access.plan ?? "free"}</span>
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar projeto…"
              className="w-56 pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Button variant="outline" onClick={() => setGalleryOpen(true)}>
            <LayoutTemplate /> Começar de um modelo
          </Button>
          <Button variant="brand" onClick={() => setCreateOpen(true)}>
            <Plus /> {isOwner(access) ? "Novo projeto de cliente" : "Novo projeto"}
          </Button>
        </div>
      </div>

      {/* Entrada prompt-first: o jeito mais rápido de começar */}
      <form
        onSubmit={handleQuickCreate}
        className="mt-8 rounded-2xl border bg-card p-2 shadow-elevated transition-shadow focus-within:ring-1 focus-within:ring-ring"
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-2 pb-2 pt-1">
            {attachments.map((attachment) => (
              <span key={attachment.id} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-secondary/60 px-2 py-1 text-[11px]">
                {attachment.kind === "image" ? <ImageIcon className="h-3 w-3 shrink-0" /> : <FileCode2 className="h-3 w-3 shrink-0" />}
                <span className="max-w-48 truncate">{attachment.name}</span>
                <button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))} aria-label={`Remover ${attachment.name}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            value={quickPrompt}
            onChange={(e) => setQuickPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleQuickCreate(e);
              }
            }}
            rows={2}
            placeholder={
              listening
                ? "Ouvindo… fale o app ou site que você quer"
                : "Descreva ou dite o app/site e pressione Enter — ex.: “um jogo da velha” ou “uma landing de cafeteria”"
            }
            className="min-h-0 resize-none border-0 text-base shadow-none focus-visible:ring-0"
          />
          <input ref={attachmentInputRef} type="file" multiple accept={PROMPT_ATTACHMENT_ACCEPT} className="hidden" onChange={(event) => addAttachments(event.target.files)} />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => attachmentInputRef.current?.click()}
            disabled={busy || attachments.length >= MAX_PROMPT_ATTACHMENTS}
            aria-label="Anexar arquivo do computador"
            title="Anexar imagem, texto ou código"
          >
            <Paperclip />
          </Button>
          <Button
            type="button"
            size="icon"
            variant={listening ? "brand" : "ghost"}
            onClick={toggleMic}
            aria-label={listening ? "Parar" : "Ditar por voz"}
            title={voiceSupported === false ? "Ditado indisponível neste navegador" : listening ? "Parar" : "Ditar por voz"}
            className={listening ? "animate-pulse-soft" : ""}
          >
            {listening ? <Square /> : <Mic />}
          </Button>
          <Button type="submit" size="icon" variant="brand" disabled={busy || !quickPrompt.trim()} aria-label="Construir">
            {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 px-2 pb-1 pt-2">
          {(isOwner(access)
            ? ["Landing para clínica odontológica", "Página de vendas de infoproduto", "Site institucional para advogado"]
            : ["Um jogo da velha", "Uma calculadora de gorjeta", "Landing page para uma cafeteria"]
          ).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setQuickPrompt(s)}
              className="rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-brand-500/60 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      </form>

      {/* Lista */}
      <div className="mt-8">
        {filtered === null ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 && !query ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed py-20 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient text-white glow-brand">
              <Sparkles className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold">Todo produto começa com uma frase</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Crie um projeto, descreva o que você quer construir e assista à primeira
              versão tomar forma em segundos.
            </p>
            <Button variant="brand" className="mt-6" onClick={() => setCreateOpen(true)}>
              <Plus /> Criar meu primeiro projeto
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">
            Nenhum projeto encontrado para “{query}”.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => (
              <Card key={p.id} className="group transition-colors hover:border-primary/50">
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between">
                    <Link href={`/projeto/${p.id}`} className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg border bg-secondary/50 text-foreground">
                        <LogoMark className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="font-medium leading-tight group-hover:text-primary">{p.name}</p>
                        <p className="text-xs text-muted-foreground">Atualizado {timeAgo(p.updated_at)}</p>
                      </div>
                    </Link>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Ações do projeto">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => router.push(`/projeto/${p.id}`)}>
                          <Pencil /> Abrir editor
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setRenameTarget(p)}>
                          <Pencil /> Renomear
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDuplicate(p)}>
                          <Copy /> Duplicar como base
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleSaveAsTemplate(p)}>
                          <Bookmark /> Salvar como modelo
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteTarget(p)}
                        >
                          <Trash2 /> Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
                    {p.description || "Sem descrição — abra o chat e comece a construir."}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {(() => {
                      const m = readMeta(p.meta);
                      if (isOwner(access) && m.status) {
                        return (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[m.status]}`}>
                            {STATUS_LABEL[m.status]}
                          </span>
                        );
                      }
                      return p.published ? (
                        <Badge variant="success" className="gap-1">
                          <Globe className="h-3 w-3" /> Publicado
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Rascunho</Badge>
                      );
                    })()}
                    {p.published && isOwner(access) && (
                      <Badge variant="success" className="gap-1">
                        <Globe className="h-3 w-3" /> No ar
                      </Badge>
                    )}
                    {readMeta(p.meta).template && (
                      <Badge variant="default" className="gap-1">
                        <Bookmark className="h-3 w-3" /> Modelo
                      </Badge>
                    )}
                    {!p.schema && <Badge variant="outline">Vazio</Badge>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Dialog: criar */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo projeto</DialogTitle>
            <DialogDescription>Dê um nome — o resto você constrói conversando.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome do projeto</Label>
              <Input id="name" name="name" placeholder="Ex.: Landing da minha cafeteria" required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Descrição (opcional)</Label>
              <Textarea id="description" name="description" placeholder="Uma frase sobre o que é este projeto" rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="brand" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />} Criar projeto
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: renomear */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renomear projeto</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRename} className="space-y-4">
            <Input name="name" defaultValue={renameTarget?.name} required autoFocus />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRenameTarget(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />} Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: excluir */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir “{deleteTarget?.name}”?</DialogTitle>
            <DialogDescription>
              Essa ação é permanente. O histórico de chat, versões e a publicação deste projeto serão removidos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Excluir para sempre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Galeria: começar de um modelo (universal: sites, apps, jogos + seus modelos) */}
      <Dialog open={galleryOpen} onOpenChange={setGalleryOpen}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Começar de um modelo</DialogTitle>
            <DialogDescription>Reaproveite um ponto de partida — site, app ou jogo — e refine no chat.</DialogDescription>
          </DialogHeader>

          {/* Modelos do usuário (projetos salvos como modelo) */}
          {(projects ?? []).some((p) => readMeta(p.meta).template) && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Seus modelos</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {(projects ?? [])
                  .filter((p) => readMeta(p.meta).template)
                  .map((p) => (
                    <button
                      key={p.id}
                      disabled={busy}
                      onClick={() => handleCreateFrom({ schema: p.schema, name: `${p.name} (cópia)` })}
                      className="rounded-lg border p-3 text-left transition-colors hover:border-brand-500/60"
                    >
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{p.description || "Modelo salvo"}</p>
                    </button>
                  ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Modelos prontos</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {STARTER_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  disabled={busy}
                  onClick={() => handleCreateFrom({ prompt: t.prompt, name: t.name })}
                  className="flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:border-brand-500/60"
                >
                  <span className="text-xl leading-none">{t.emoji}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t.name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{t.desc}</span>
                    <span className="mt-1 inline-block rounded-full bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t.kind === "app" ? "app" : "site"}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          {busy && (
            <p className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Criando projeto…
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
