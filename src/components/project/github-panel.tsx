"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, GitBranch, Github, Loader2, RefreshCw, Unplug, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Connection = {
  installationId: number;
  owner: string;
  repo: string;
  branch: string;
  rootPath: string;
  lastRemoteSha?: string;
  lastLocalFingerprint?: string;
  lastSyncedAt?: string;
  status?: "idle" | "syncing" | "synced" | "conflict" | "error";
  webUrl?: string;
};

type GitHubStatus = {
  configured: boolean;
  appSlug?: string;
  installUrl?: string | null;
  connection: Connection | null;
};

interface Props {
  projectId: string;
  enabled: boolean;
}

function statusLabel(status?: Connection["status"]) {
  switch (status) {
    case "syncing": return "Sincronizando";
    case "synced": return "Sincronizado";
    case "conflict": return "Conflito";
    case "error": return "Erro";
    default: return "Conectado";
  }
}

export function GitHubPanel({ projectId, enabled }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [installationId, setInstallationId] = useState("");
  const [repository, setRepository] = useState("");
  const [branch, setBranch] = useState("main");
  const [rootPath, setRootPath] = useState("");

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/github/${projectId}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Falha ao consultar GitHub.");
      setStatus(json);
      if (json.connection) {
        setInstallationId(String(json.connection.installationId || ""));
        setRepository(`${json.connection.owner}/${json.connection.repo}`);
        setBranch(json.connection.branch || "main");
        setRootPath(json.connection.rootPath || "");
      }
    } catch (error: any) {
      toast.error("Não foi possível consultar o GitHub", { description: error?.message });
    } finally {
      setLoading(false);
    }
  }, [enabled, projectId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function run(action: "connect" | "push" | "pull" | "disconnect") {
    setLoading(true);
    try {
      const response = await fetch(`/api/github/${projectId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "connect"
          ? { action, installationId: Number(installationId), repository, branch, rootPath }
          : { action }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Operação GitHub falhou.");
      if (action === "pull" && json?.reload) {
        toast.success("Código puxado do GitHub", { description: `${json.changedFiles?.length || 0} arquivo(s) atualizados.` });
        window.location.reload();
        return;
      }
      toast.success(
        action === "connect" ? "Repositório conectado" :
        action === "push" ? (json.unchanged ? "GitHub já está atualizado" : "Código enviado ao GitHub") :
        action === "pull" ? "GitHub já está sincronizado" : "GitHub desconectado"
      );
      await load();
    } catch (error: any) {
      toast.error("Operação GitHub não concluída", { description: error?.message || "Tente novamente." });
      await load();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={!enabled}
          aria-label="GitHub do projeto"
          title={enabled ? "GitHub: conectar, puxar e enviar" : "Gere um aplicativo antes de conectar ao GitHub"}
        >
          <Github />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>GitHub do projeto</DialogTitle>
          <DialogDescription>
            Sincronização bidirecional via GitHub App. Tokens de instalação são temporários e não ficam salvos no projeto.
          </DialogDescription>
        </DialogHeader>

        {loading && !status ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Consultando integração…
          </div>
        ) : status && !status.configured ? (
          <div className="rounded-lg border p-4 text-sm">
            <p className="font-medium">GitHub App ainda não está configurado na Vercel.</p>
            <p className="mt-1 text-muted-foreground">Configure GITHUB_APP_ID e GITHUB_APP_PRIVATE_KEY no ambiente de produção.</p>
          </div>
        ) : status?.connection ? (
          <div className="space-y-4">
            <div className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{status.connection.owner}/{status.connection.repo}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <GitBranch className="mr-1 inline h-3.5 w-3.5" />
                    {status.connection.branch}{status.connection.rootPath ? ` · /${status.connection.rootPath}` : ""}
                  </p>
                </div>
                <span className="rounded-full border px-2.5 py-1 text-xs font-medium">{statusLabel(status.connection.status)}</span>
              </div>
              {status.connection.lastSyncedAt && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Última sincronização: {new Date(status.connection.lastSyncedAt).toLocaleString("pt-BR")}
                </p>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button onClick={() => void run("push")} disabled={loading}>
                {loading ? <Loader2 className="animate-spin" /> : <Upload />}
                Enviar para GitHub
              </Button>
              <Button variant="outline" onClick={() => void run("pull")} disabled={loading}>
                {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Puxar do GitHub
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              {status.connection.webUrl && (
                <Button variant="ghost" size="sm" asChild>
                  <a href={status.connection.webUrl} target="_blank" rel="noreferrer"><ExternalLink /> Abrir repositório</a>
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => void run("disconnect")} disabled={loading}>
                <Unplug /> Desconectar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {status?.installUrl && (
              <div className="rounded-lg border bg-secondary/20 p-3 text-sm">
                <p className="font-medium">1. Instale ou autorize o AD Studio no repositório.</p>
                <Button variant="link" className="h-auto px-0" asChild>
                  <a href={status.installUrl} target="_blank" rel="noreferrer">Abrir instalação do GitHub App <ExternalLink className="ml-1 h-3.5 w-3.5" /></a>
                </Button>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Installation ID</Label>
                <Input value={installationId} onChange={(e) => setInstallationId(e.target.value)} inputMode="numeric" placeholder="Ex.: 12345678" />
              </div>
              <div className="space-y-2">
                <Label>Repositório</Label>
                <Input value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="owner/repositorio" />
              </div>
              <div className="space-y-2">
                <Label>Branch</Label>
                <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
              </div>
              <div className="space-y-2">
                <Label>Pasta raiz (opcional)</Label>
                <Input value={rootPath} onChange={(e) => setRootPath(e.target.value)} placeholder="apps/meu-projeto" />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {status?.configured && !status.connection && (
            <Button onClick={() => void run("connect")} disabled={loading || !installationId.trim() || !repository.trim()}>
              {loading ? <Loader2 className="animate-spin" /> : <Github />}
              Conectar repositório
            </Button>
          )}
          <Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
