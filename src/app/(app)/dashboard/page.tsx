"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/utils";
import { resolvePlan, isOwner, type AccessProfile } from "@/lib/access";
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

interface Project {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
  published: boolean;
  schema: unknown;
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

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, description, updated_at, published, schema")
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
          <h1 className="text-2xl font-bold tracking-tight">Seus projetos</h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {projects ? `${projects.length} projeto${projects.length === 1 ? "" : "s"}` : "Carregando…"}
            {isOwner(access) ? (
              <Badge className="gap-1">Owner · acesso total</Badge>
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
          <Button variant="brand" onClick={() => setCreateOpen(true)}>
            <Plus /> Novo projeto
          </Button>
        </div>
      </div>

      {/* Entrada prompt-first: o jeito mais rápido de começar */}
      <form
        onSubmit={handleQuickCreate}
        className="mt-8 rounded-2xl border bg-card p-2 shadow-elevated transition-shadow focus-within:ring-1 focus-within:ring-ring"
      >
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
            placeholder="Descreva o que você quer construir e pressione Enter — ex.: “um dashboard de vendas com KPIs e gráfico”"
            className="min-h-0 resize-none border-0 text-base shadow-none focus-visible:ring-0"
          />
          <Button type="submit" size="icon" variant="brand" disabled={busy || !quickPrompt.trim()} aria-label="Construir">
            {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 px-2 pb-1 pt-2">
          {[
            "Landing page para uma cafeteria",
            "Dashboard de vendas com KPIs",
            "Portfólio de fotografia",
          ].map((s) => (
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
                          <Copy /> Duplicar
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
                  <div className="mt-3 flex items-center gap-2">
                    {p.published ? (
                      <Badge variant="success" className="gap-1">
                        <Globe className="h-3 w-3" /> Publicado
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Rascunho</Badge>
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
    </div>
  );
}
